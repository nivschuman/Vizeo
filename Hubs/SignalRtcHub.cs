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

            await dbContext.users.AddAsync(userModel);
            await dbContext.SaveChangesAsync();

            //await Clients.Client(Context.ConnectionId).SendAsync("SendOffer", toConnectionId);
        }

        public async Task FindMate()
        {
            UserModel user = await dbContext.users.FindAsync(Context.ConnectionId);

            //has not joined yet, not in database
            if(user == null)
            {
                return;
            }

            //set user status to 0
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

            //change status of both to connecting
            user.Status = 1;
            match.Status = 1;
            await dbContext.SaveChangesAsync();

            //update peer user data
            await Clients.Client(user.ConnectionId).SendAsync("PeerData", JsonSerializer.Serialize(match));
            await Clients.Client(match.ConnectionId).SendAsync("PeerData", JsonSerializer.Serialize(user));

            //connect user and match
            await Clients.Client(Context.ConnectionId).SendAsync("SendOffer", match.ConnectionId);
        }

        public async Task PassOffer(string toConnectionId, string offer)
        {
            await Clients.Client(toConnectionId).SendAsync("SendAnswer", Context.ConnectionId, offer);
        }

        public async Task PassAnswer(string toConnectionId, string answer)
        {
            await Clients.Client(toConnectionId).SendAsync("HandleAnswer", Context.ConnectionId, answer);
        }

        public override async Task OnDisconnectedAsync(Exception? exception)
        {
            UserModel user = await dbContext.users.FindAsync(Context.ConnectionId);

            if(user != null)
            {
                dbContext.Remove(user);
            }

            await dbContext.SaveChangesAsync();

            await base.OnDisconnectedAsync(exception);
        }
    }
}
