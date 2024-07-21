using System.ComponentModel.DataAnnotations;
using System.Reflection.Metadata.Ecma335;
using Microsoft.EntityFrameworkCore;

namespace VideoProject.Models
{
    public class UserHistoryModel
    {
        [Key]
        public int Id { get; set; }
        public string Name { get; set; }
        public string Country { get; set; }
        public int Age { get; set; }
        public string Gender { get; set; }
        public string InterestedIn { get; set; }
        public DateTime? JoinDateTimeUtc { get; set; }
        public DateTime? LeaveDateTimeUtc { get; set; }
    }
}
