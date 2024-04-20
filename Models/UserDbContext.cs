using Microsoft.EntityFrameworkCore;

namespace VideoProject.Models
{
    public class UserDbContext : DbContext
    {
        public DbSet<UserModel> users { get; set; } = null;

        public UserDbContext(DbContextOptions<UserDbContext> options) : base(options)
        {
            
        }
    }
}
