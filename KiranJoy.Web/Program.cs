using BlazorStatic;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using KiranJoy.Web.Components;

var builder = WebApplication.CreateBuilder(args);

builder.WebHost.UseStaticWebAssets();

builder.Services.AddBlazorStaticService(opt => {
    opt.ShouldGenerateSitemap = true;
    opt.SiteUrl = WebsiteKeys.SiteUrl;
}
)
.AddBlazorStaticContentService<BlogFrontMatter>(opt => {
    // modify blog post before they are genedated to html
    // opt.AfterContentParsedAndAddedAction = (service, contentService) => {
    //     contentService.Posts.ForEach(post => {
    //         post.Url = $"{post.Url}-nice"; // add nice to every url
    //         post.FrontMatter.Published = DateTime.Now; //change post metadata
    //     });
    // };

    // opt.PageUrl = "my-blog"; // if you need to change the resulting url. Defaut is "blog"
    // opt.ContentPath = "MyContent/Posts"; // where resides your blog posts?


}) //
// .AddBlazorStaticContentService<MyFrontMatter>() // any other "content section" on your page with a differet FrontMatter? For example /projects
;

builder.Services.AddRazorComponents();

var app = builder.Build();

// Configure the HTTP request pipeline.
if(!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}

app.UseStaticFiles();
app.UseAntiforgery();

app.MapRazorComponents<App>();

app.UseBlazorStaticGenerator(shutdownApp: !app.Environment.IsDevelopment());

app.Run();

public static class WebsiteKeys
{
    // TODO: update these with your real handles/URLs.
    public const string SiteUrl = "https://kiranjoy.blog";
    public const string GitHubRepo = "https://github.com/kijoyin/kirans-web";
    public const string GitHub = "https://github.com/kijoyin";
    public const string LinkedIn = "https://www.linkedin.com/in/kjoy/";
    public const string X = "https://x.com/";
    public const string Email = "kijoyin@gmail.com";

    public const string Name = "Kiran Joy";
    public const string Title = "Kiran Joy";
    public const string Tagline = "Integration Architect &amp; Engineering Manager — .NET, Azure &amp; AI";
    public const string BlogPostStorageAddress = $"{GitHubRepo}/tree/main/KiranJoy.Web/Content/Blog";
    public const string BlogLead = "Field notes on .NET, cloud integration, Kubernetes, home labs and applied AI.";
}
