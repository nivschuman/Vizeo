using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;

namespace VideoProject.Models
{
    public class UserConnectionModel
    {
        [Key]
        public int Id { get; set; }
        public string User1ConnectionId { get; set; }
        public string User2ConnectionId { get; set; }

        public DateTime ConnectedTime { get; set; }
    }
}