---
title: "Authentication UI workflow in Blazor : Redirecting using code"
lead: "Authentication UI workflow in Blazor : Redirecting using code using IUriHelper from the Microsoft.AspNetCore.Components.Services library"
published: 2019-04-10
tags: [blazor]
authors:
    - name: "Kiran Joy"
---

> **Blazor preview build : 3.0.0-preview5-19227-01**
> 
> Blazor is now in preview and not experimental anymore. With each preview build there is a lot of breaking changes. The above code will work with the latest preivew build mentioned above.

Sometimes you have to redirect using code in your client side application and one common use case is redirect users to the login page when not authenticated. [Blazor](https://blazor.net/) is an expreimental framework letting developers write C# on the client side making use of webassenly.To keep the code in a centralised location we will be writing the logic to do the redirection in **MainLayout.cshtml**.  

Below is the full code for MainLayout.cshtml. There is only 2 lines of code that is of intereset to us here.In **Line 1** we are injecting the **IUriHelper** and in **Line 17** we are using the **NavigateTo** method to redirect to the loging page when the user is not authenticated.

@inject Microsoft.AspNetCore.Components.IUriHelper UriHelper
@inherits LayoutComponentBase

    <div>
        @Body
    </div>

@functions
{
    // TODO : Setting as not authenticated to false for demo 
    private bool IsAuthenticated = false;

    protected override void OnInit()
    {
        if (!IsAuthenticated)
        {
            UriHelper.NavigateTo(@"\\login");
        }
    }
}

#### Additional resources

-   [Router enhancements for Blazor](https://github.com/aspnet/AspNetCore/issues/5489)
-   [Blazor router source code in Github](https://github.com/aspnet/Blazor/blob/release/0.1.0/src/Microsoft.AspNetCore.Blazor/Routing/Router.cs)
