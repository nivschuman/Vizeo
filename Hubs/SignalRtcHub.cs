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

        public SignalRtcHub(UserDbContext dbContext) : base()
        {
            this.dbContext = dbContext;
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
            UserModel user = await dbContext.users.FindAsync(Context.ConnectionId);

            //has not joined yet, not in database
            if(user == null)
            {
                return;
            }

            //set user status to 0, waiting status
            user.Status = 0;
            await dbContext.SaveChangesAsync();

            //get interests
            string[] interests = user.InterestedIn.Split(";");
            bool sameCountry = bool.Parse(interests[0]);
            bool male = bool.Parse(interests[1]);
            bool female = bool.Parse(interests[2]);

            //find match
            UserModel match = null;
            if(sameCountry)
            {
                if((male && female) || (!male && !female))
                {
                    match = dbContext.users.FirstOrDefault(other => other.Country == user.Country && other.Status == 0 && other.ConnectionId != user.ConnectionId);
                }
                else if(male && !female)
                {
                    match = dbContext.users.FirstOrDefault(other => other.Country == user.Country && other.Gender == "male" && other.Status == 0 && other.ConnectionId != user.ConnectionId);
                }
                else if(!male && female)
                {
                    match = dbContext.users.FirstOrDefault(other => other.Country == user.Country && other.Gender == "female" && other.Status == 0 && other.ConnectionId != user.ConnectionId);
                }
            }
            else
            {
                if((male && female) || (!male && !female))
                {
                    match = dbContext.users.FirstOrDefault(other => other.Status == 0 && other.ConnectionId != user.ConnectionId);
                }
                else if(male && !female)
                {
                    match = dbContext.users.FirstOrDefault(other => other.Gender == "male" && other.Status == 0 && other.ConnectionId != user.ConnectionId);
                }
                else if(!male && female)
                {
                    match = dbContext.users.FirstOrDefault(other => other.Gender == "female" && other.Status == 0 && other.ConnectionId != user.ConnectionId);
                }
            }

            //no match was found
            if(match == null)
            {
                return;
            }

            //change status of both to 1, connecting status
            user.Status = 1;
            match.Status = 1;
            await dbContext.SaveChangesAsync();

            //change peer id of both to eachother
            user.PeerId = match.ConnectionId;
            match.PeerId = user.ConnectionId;
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
            //TBD check if accidently trying to send offer to already connected user
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
            UserModel user = await dbContext.users.FindAsync(Context.ConnectionId);

            if(user == null || user.PeerId == null)
            {
                return;
            }

            UserModel peer = await dbContext.users.FindAsync(user.PeerId);

            if(peer == null)
            {
                return;
            }

            //remove peer id for both and change their status to waiting
            user.PeerId = null;
            user.Status = 2;
            peer.PeerId = null;
            peer.Status = 2;
            await dbContext.SaveChangesAsync();

            //We must make sure to have each user call FindMate one after the other
            //This is in order to avoid race condition of two users sending offers to eachother at the same time
            //This results in answer sdep cannot be set because connection is stable
            //So we call FindMate for user to go back to waiting or find new peer
            //Once that is complete, we announce to the peer that there was a disconnect, he disconnects connection and calls FindMate on his own

            //invoke find mate for user to place him in waiting or find him new peer
            //only called is user is interested in finding new mate, otherwise he just wanted to stop
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
            UserModel user = await dbContext.users.FindAsync(Context.ConnectionId);

            if(user != null)
            {
                dbContext.Remove(user);
            }

            await dbContext.SaveChangesAsync();

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
            UserModel user = await dbContext.users.FindAsync(Context.ConnectionId);

            //user doesn't exist or is connected to other user (cannot stop mid connection, must disconnect first)
            if(user == null || user.Status == 1)
            {
                return;
            }

            //set user status to 2, stopped status
            user.Status = 2;
            await dbContext.SaveChangesAsync();
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
