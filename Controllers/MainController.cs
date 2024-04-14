using Microsoft.AspNetCore.Mvc;
using VideoProject.Models;

namespace VideoProject.Controllers
{
    public class MainController : Controller
    {
        public IActionResult Index()
        {
            return View("Main");
        }
    }
}
