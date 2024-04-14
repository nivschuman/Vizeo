using Microsoft.AspNetCore.SignalR;
using VideoProject.Models;

namespace VideoProject.Hubs
{
    public class SignalRtcHub : Hub
    {
        public static Queue<string>? waiting = new Queue<string>();
        public async Task Join()
        {
            if(waiting.Count == 0)
            {
                waiting.Enqueue(Context.ConnectionId);

                return;
            }

            string toConnectionId = waiting.Dequeue();

            await Clients.Client(Context.ConnectionId).SendAsync("SendOffer", toConnectionId);
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
