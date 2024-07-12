using System.Data;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using VideoProject.Models;

namespace VideoProject.Hubs
{
    public class SignalRtcHub : Hub
    {
        private UserDbContext dbContext;

        private readonly object connectToPeerLock;

        public SignalRtcHub(UserDbContext dbContext) : base()
        {
            this.dbContext = dbContext;
            connectToPeerLock = new object();
        }

        public async Task Join(string userData)
        {
            UserData user = JsonSerializer.Deserialize<UserData>(userData);

            UserModel userModel = new UserModel();
            userModel.ConnectionId = Context.ConnectionId;
            userModel.Name = user.Name;
            userModel.Country = user.Country;
            userModel.Age = user.Age;
            userModel.Gender = user.Gender;
            userModel.InterestedIn = user.InterestedIn;
            userModel.Status = 0;
            userModel.PeerId = null;

            await dbContext.users.AddAsync(userModel);
            await dbContext.SaveChangesAsync();

            await UpdateCountsAll();
        }

        public async Task FindMate()
        {
            UserModel? user = await dbContext.users.FindAsync(Context.ConnectionId);

            //has not joined yet, not in database
            if(user == null)
            {
                return;
            }

            //set user status to 0, waiting status
            user.Status = 0;
            await dbContext.SaveChangesAsync();

            //find match that user can connect to
            UserModel? match = null;
            bool canConnect = false;

            while(!canConnect)
            {
                match = GetMatch(user);

                //no match was found
                if(match == null)
                {
                    return;
                }

                //try to set connecting status
                lock(connectToPeerLock)
                {
                    //RACE CONDITION FIX
                    //another user got the same match and already connected to him, need to find different mate
                    if(match.Status == 1)
                    {
                        canConnect = false;
                    }
                    //change status of both to 1, connecting status
                    else
                    {                   
                        user.Status = 1;
                        match.Status = 1;
                        dbContext.SaveChanges();
                        canConnect = true;
                    }
                }
            }

            //change peer id of both to eachother
            user.PeerId = match.ConnectionId;
            match.PeerId = user.ConnectionId;
            await dbContext.SaveChangesAsync();

            //update connection time between peer and match
            UserConnectionModel userConnection = dbContext.userConnections.FirstOrDefault(ucm => 
            (ucm.User1ConnectionId == user.ConnectionId && ucm.User2ConnectionId == match.ConnectionId) || 
            (ucm.User1ConnectionId == match.ConnectionId && ucm.User2ConnectionId == user.ConnectionId));

            if(userConnection == null)
            {
                userConnection = new UserConnectionModel();
                userConnection.User1ConnectionId = user.ConnectionId;
                userConnection.User2ConnectionId = match.ConnectionId;
                userConnection.ConnectedTime = DateTime.Now;

                await dbContext.userConnections.AddAsync(userConnection);
            }
            else
            {
                userConnection.ConnectedTime = DateTime.Now;
            }

            await dbContext.SaveChangesAsync();

            //update peer user data
            await Clients.Client(user.ConnectionId).SendAsync("PeerData", JsonSerializer.Serialize(match));
            await Clients.Client(match.ConnectionId).SendAsync("PeerData", JsonSerializer.Serialize(user));

            //connect user and match
            await Clients.Client(Context.ConnectionId).SendAsync("SendOffer", match.ConnectionId);

            //number of users chatting has changed, update counts
            await UpdateCountsAll();
        }

        public async Task PassOffer(string toConnectionId, string offer)
        {
            //TBD is it possible that we accidentally pass an offer to a stopped peer (status 2)!?
            await Clients.Client(toConnectionId).SendAsync("SendAnswer", Context.ConnectionId, offer);
        }

        public async Task PassAnswer(string toConnectionId, string answer)
        {
            await Clients.Client(toConnectionId).SendAsync("HandleAnswer", Context.ConnectionId, answer);
        }

        public async Task PassCandidate(string toConnectionId, string candidate)
        {
            await Clients.Client(toConnectionId).SendAsync("HandleCandidate", Context.ConnectionId, candidate);
        }

        public async Task DisconnectFromPeer(bool findNewMate)
        {
            UserModel? user = await dbContext.users.FindAsync(Context.ConnectionId);

            if(user == null || user.PeerId == null)
            {
                return;
            }

            UserModel? peer = await dbContext.users.FindAsync(user.PeerId);

            if(peer == null)
            {
                return;
            }

            //remove peer id for both and change their status to stopped
            user.PeerId = null;
            user.Status = 2;
            peer.PeerId = null;
            peer.Status = 2;
            await dbContext.SaveChangesAsync();

            //We must make sure to have each user call FindMate one after the other
            //This is in order to avoid race condition of two users sending offers to eachother at the same time
            //This results in answer sdp cannot be set because connection is stable
            //So we call FindMate for user to go back to waiting or find new peer
            //Once that is complete, we announce to the peer that there was a disconnect, he disconnects connection and calls FindMate on his own

            //invoke find mate for user to place him in waiting or find him new peer
            //only called if user is interested in finding new mate, otherwise he just wanted to stop
            if(findNewMate)
            {
                await FindMate();
            }

            //notfiy peer on disconnection and let him search for new peer
            await Clients.Client(peer.ConnectionId).SendAsync("PeerDisconnected");

            //chatting count changed, update counts
            await UpdateCountsAll();
        }

        public override async Task OnDisconnectedAsync(Exception? exception)
        {
            UserModel? user = await dbContext.users.FindAsync(Context.ConnectionId);

            //no user to remove and disconnect
            if(user == null)
            {
                return;
            }

            //disconnect peer from user
            if(user.PeerId != null)
            {
                await DisconnectFromPeer(false);
            }

            //remove all userConnections tied to user
            IEnumerable<UserConnectionModel> userConnections = dbContext.userConnections.Where(ucm => ucm.User1ConnectionId == user.ConnectionId || ucm.User2ConnectionId == user.ConnectionId);
            foreach(UserConnectionModel userConnection in userConnections)
            {
                dbContext.Remove(userConnection);
            }

            //remove user from database
            dbContext.Remove(user);
            await dbContext.SaveChangesAsync();

            //update counts for all
            await UpdateCountsAll();

            await base.OnDisconnectedAsync(exception);
        }

        public async Task UpdateCountsClient()
        {
            List<UserModel> malesList = await dbContext.users.Where(user => user.Gender == "male").ToListAsync();
            List<UserModel> femalesList = await dbContext.users.Where(user => user.Gender == "female").ToListAsync();
            List<UserModel> chattingList = await dbContext.users.Where(user => user.Status == 1).ToListAsync();

            await Clients.Client(Context.ConnectionId).SendAsync("UpdateCounts", malesList.Count, femalesList.Count, chattingList.Count);
        }

        public async Task StopSearching()
        {
            UserModel? user = await dbContext.users.FindAsync(Context.ConnectionId);

            //user doesn't exist or is connected to other user (cannot stop mid connection, must disconnect first)
            if(user == null || user.Status == 1)
            {
                return;
            }

            //set user status to 2, stopped status
            user.Status = 2;
            await dbContext.SaveChangesAsync();
        }

        //find matching peer for user, returns null if there is no match
        private UserModel? GetMatch(UserModel user)
        {
            //get interests
            string[] interests = user.InterestedIn.Split(";");
            bool sameCountry = bool.Parse(interests[0]);
            bool male = bool.Parse(interests[1]);
            bool female = bool.Parse(interests[2]);

            //search for match
            List<UserModel> matches = null;
            if(sameCountry)
            {
                if((male && female) || (!male && !female))
                {
                    matches = dbContext.users.Where(other => other.Country == user.Country && other.Status == 0 && other.ConnectionId != user.ConnectionId).ToList();
                }
                else if(male && !female)
                {
                    matches = dbContext.users.Where(other => other.Country == user.Country && other.Gender == "male" && other.Status == 0 && other.ConnectionId != user.ConnectionId).ToList();
                }
                else if(!male && female)
                {
                    matches = dbContext.users.Where(other => other.Country == user.Country && other.Gender == "female" && other.Status == 0 && other.ConnectionId != user.ConnectionId).ToList();
                }
            }
            else
            {
                if((male && female) || (!male && !female))
                {
                    matches = dbContext.users.Where(other => other.Status == 0 && other.ConnectionId != user.ConnectionId).ToList();
                }
                else if(male && !female)
                {
                    matches = dbContext.users.Where(other => other.Gender == "male" && other.Status == 0 && other.ConnectionId != user.ConnectionId).ToList();
                }
                else if(!male && female)
                {
                    matches = dbContext.users.Where(other => other.Gender == "female" && other.Status == 0 && other.ConnectionId != user.ConnectionId).ToList();
                }
            }

            //find match farthest from now datetime
            UserModel bestMatch = null;
            double bestDiff = double.NegativeInfinity;

            DateTime nowDateTime = DateTime.Now;

            foreach(UserModel match in matches)
            {
                UserConnectionModel userConnection = dbContext.userConnections.FirstOrDefault(ucm => 
                (ucm.User1ConnectionId == user.ConnectionId && ucm.User2ConnectionId == match.ConnectionId) || 
                (ucm.User1ConnectionId == match.ConnectionId && ucm.User2ConnectionId == user.ConnectionId));

                //user and match have never connected before
                if(userConnection == null)
                {
                    bestMatch = match;
                    bestDiff = double.PositiveInfinity;
                    break;
                }

                double curDiff = Math.Abs((nowDateTime - userConnection.ConnectedTime).TotalSeconds);

                if(curDiff > bestDiff)
                {
                    bestMatch = match;
                    bestDiff = curDiff;
                }
            }

            return bestMatch;
        }

        private async Task UpdateCountsAll()
        {
            List<UserModel> malesList = await dbContext.users.Where(user => user.Gender == "male").ToListAsync();
            List<UserModel> femalesList = await dbContext.users.Where(user => user.Gender == "female").ToListAsync();
            List<UserModel> chattingList = await dbContext.users.Where(user => user.Status == 1).ToListAsync();

            await Clients.All.SendAsync("UpdateCounts", malesList.Count, femalesList.Count, chattingList.Count);
        }
    }
}
