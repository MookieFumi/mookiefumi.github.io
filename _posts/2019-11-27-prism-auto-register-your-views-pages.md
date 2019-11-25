---
layout: post
title: Prism. Auto-register your views/ pages (Xamarin Forms)
published: true
---

## Prism. Auto-register your views/ pages

This is quick blog post and I want to share with you how I solve a recurrent issue working with [Prism](https://prismlibrary.github.io) and MVVM in a Xamarin Forms project. I've working on several teams and projects for years and it's common to forget register a new Page (we're humans), or even worst, loose it in a git merge because the conflict is not resolve properly (i.e. team members including new features at the same time).

At least in my projects all the Views/ ViewModels are registered in the same way.

I know that the [Prism](https://prismlibrary.github.io) guys ([Brian Lagunas](https://twitter.com/brianlagunas), [Dan Siegel](https://twitter.com/DanJSiegel)) have include a new attribute to auto register the Views. This new attribute was included in the version [7.2.0.1367](https://github.com/PrismLibrary/Prism/releases/tag/v7.2.0.1367) and the name is **AutoRegisterForNavigation**. IMHO it's a good option but it's not my preferred one because the attributes usually are hidden (a little bit) in the code and if the team is not a mature one maybe it's hard to find it or to tell what the magic happens.

I usually create two extension methods of **IContainerRegistry**, one to register my services and another one to register my Views/ ViewModels in order to clear my App.xaml.cs file. I really hate having too much code here.

```csharp
public partial class App : PrismApplication
{
    protected override void RegisterTypes(IContainerRegistry containerRegistry)
    {
        containerRegistry.RegisterServices();
        containerRegistry.RegisterPages();
    }
}

public static class ContainerRegistryExtensions
{
    public static void RegisterServices(this IContainerRegistry containerRegistry)
    {
        containerRegistry.Register<ISalesService, SalesService>();
    }

    public static void RegisterPages(this IContainerRegistry containerRegistry)
    {
        containerRegistry.RegiterForNavigation<SalesView>();
    }
}
```

It's clear to auto-register your pages you have to use reflection and I usually like to use a marker interface instead of use a type so with a single marker interface we can do it.

```csharp
//This is the marker interface
public interface IRegisterablePage
{
}
```

And every page or even better, your View/ Page base class has to implement the marker interface.

```csharp
//Could be your view/ page base class
public partial class OrdersView : ContentPage, IRegisterablePage
{
    public OrdersView()
    {
        InitializeComponent();
    }
}
```

And the code to register your Views/ Pages now is:

```csharp
public static void RegisterPages(this IContainerRegistry containerRegistry)
{
    //Register any page that have not implement the marker interface
    containerRegistry.RegisterForNavigation<NavigationPage>();

    //Auto-register the Views/ Pages
    var pages = GetClasses<IRegisterablePage>();
    foreach (var page in pages)
    {
        containerRegistry.RegisterForNavigation(page, page.Name);
    }
}

private static IEnumerable<Type> GetClasses<T>()
{
    return AppDomain.CurrentDomain.GetAssemblies()
        .SelectMany(s => s.GetTypes())
        .Where(p => p.IsClass && typeof(T).IsAssignableFrom(p));
}
```

## Links

* [Prism. TypeAutoLoadExtensions.cs file in Github](https://github.com/PrismLibrary/Prism/blob/5c11a75876ba6409d6454a0af21570a82966a6dd/Source/Xamarin/Prism.Forms/Ioc/TypeAutoLoadExtensions.cs)
