using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;

namespace VideoProject.Models
{
    public class UserModel
    {
        [Key]
        public string ConnectionId { get; set; }
        public string Name { get; set; }
        public string Country { get; set; }
        public int Age { get; set; }
        public string Gender { get; set; }
        public string InterestedIn { get; set; }
        public int Status { get; set; }
        public string? PeerId { get; set; }
    }
}
