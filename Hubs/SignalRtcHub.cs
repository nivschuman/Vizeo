using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
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

        public async Task PassOffer(string toConnectionId, string offer)
        {
            await Clients.Client(toConnectionId).SendAsync("SendAnswer", Context.ConnectionId, offer);
        }

        public async Task PassAnswer(string toConnectionId, string answer)
        {
            await Clients.Client(toConnectionId).SendAsync("HandleAnswer", Context.ConnectionId, answer);
        }
    }
}
