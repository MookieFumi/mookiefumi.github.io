---
layout: post
title: Feature folders with Prism (Xamarin Forms)
published: true
---

## Feature folders with Prism - Xamarin Forms

> This is the english version of my spanish blog post about how to organize our Prism Xamarin Forms project with feature folder.

### Introduction

I've been using Prism as MVVM framework in my last business and personal projects and if I have to choose my favorite feature maybe I would choose the ability to extend and customize the default behavior.

So, in this case I would like to speak about the way I organize my project in **Feature folders**. What does it mean? Could I apply it in a Xamarin Forms application with Prism?

I've been working as backend developer for years and the tendency once the projects started to grow was apply the **Feature folders** structure, that is, group by folder the app features so the project structure should be like this:

```bash
│   App.xaml
│   App.xaml.cs
│
└───Features
│   │
│   └───Dashboard
│       │   Model
│       │   Services
│       │   ViewModels
│       │   Services
│       │   Views
│   └───Orders
│       │   Model
│       │   Services
│       │   ViewModels
│       │   Services
│       │   Views
```

The main advantage of this type of grouping is the easy location of the files that we want to modify and also an easy way to the new team members to take knowledge about the project.

> It's also comfortable because if you're working with Visual Studio for Windows you can use the option "Scope to" in the solution explorer to focus on a single feature.

### How to register out View and ViewModels

We have two ways to register our Views and ViewModels in Prism using the generic option.

* Specifiying the View and the ViewModel in the method **RegisterForNavigation**. So, that's all. We could work with Feature folders if we are explicits and we set up which View works with a concrete ViewModel. Let me say that It's also the fastest way because with this method we're not using reflection.

```csharp
container.RegisterForNavigation<SalesView, SalesViewModel>();
```

* Specifiying only the View in the method **RegisterForNavigation** the Prism container will search the ViewModel according to the ViewModelLocator configuration and as you remember the default configuration is:

  * The Views and the ViewModels must be in the **same assembly**.
  * The ViewModels must be in the **ViewModels namespace**.
  * The Views must be in the **Views namespace**.
  * The **name** of the **ViewModels** must be the same as the views but **finished in ViewModel**.

```csharp
container.RegisterForNavigation<SalesView>();
```

> So, to work with **Feature folder** we should modify the default behaviour of the Prism ViewModelLocator that comes out of the box since it will not be able to resolve the ViewModel with this new structure.

### How to modoify the ViewModelLocator

As you remember when we setup our Xamarin Forms application we have to inherit from **PrismApplication** and we must to override the methods *OnInitialized* y *RegisterTypes*. But these are not the only available methods to override since Prism por example have one to override the default behaviour of the ViewModelLocator. The method is **ConfigureViewModelLocator** and it's the place to set the Resolver of ViewModelLocationProvider.

```csharp
protected override void ConfigureViewModelLocator()
{
    base.ConfigureViewModelLocator();

    //We set here the type resolver
    ViewModelLocationProvider.SetDefaultViewTypeToViewModelTypeResolver(GetViewModelName);
}

private Type GetViewModelName(Type viewType)
{
    var viewModelName = viewType.FullName.Replace("Views", "ViewModels");
    var viewAssemblyName = viewType.GetTypeInfo().Assembly.FullName;
    return Type.GetType($"{viewModelName}Model, {viewAssemblyName}");
}
```

> **Summary**: if you set your ViewModel when you register your page it's enough and you'll be able to work with Feature folders but if you're one that like using the ViewModelLocator and don't set the ViewModel when you register your View this is an interesting option.

### Links

* [Prism ViewModelLocator](https://prismlibrary.github.io/docs/viewmodel-locator.html)
* [Feature Folder Structure in ASP.NET Core](https://scottsauber.com/2016/04/25/feature-folder-structure-in-asp-net-core/)