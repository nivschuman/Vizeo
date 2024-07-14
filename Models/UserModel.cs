using System.ComponentModel.DataAnnotations;
using System.Reflection.Metadata.Ecma335;
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

        //return if this user is interested in other user
        public bool IsInterestedIn(UserModel other)
        {
            //get interests
            string[] interests = InterestedIn.Split(";");
            bool sameCountry = bool.Parse(interests[0]);
            bool male = bool.Parse(interests[1]);
            bool female = bool.Parse(interests[2]);

            if(sameCountry)
            {
                    if((male && female) || (!male && !female))
                    {
                        return other.Country == Country;
                    }
                    else if(male && !female)
                    {
                        return other.Country == Country && other.Gender == "male";
                    }
                    else if(!male && female)
                    {
                        return other.Country == Country && other.Gender == "female";
                    }
            }
            else
            {
                if((male && female) || (!male && !female))
                {
                    return true;
                }
                else if(male && !female)
                {
                    return other.Gender == "male";
                }
                else if(!male && female)
                {
                    return other.Gender == "female";
                }
            }

            return false;
        }
    }
}
