---
layout: post
title: Feature folders con Prism (Xamarin Forms)
published: true
---

## Feature folders con Prism - Xamarin Forms

### Introducción

He estado usando Prism como framework de MVVM en mis últimos proyectos tanto empresariales como empresariales y si tuviera que elegir algo especial elegiría la capacidad de extenender y personalizar su configuración.

En este caso me gustaría hablar de como organizar nuestro proyecto mediante "Feature folders". ¿En qué consiste? ¿Se puede aplicar en una aplicación de Xamarin Forms con Prism?

He estado trabajando como desarrollador de backend durante años y la tendencia una vez que el proyecto empezaba a ser grande era orgizarlo mediante feature folders, es decir, agrupar en carpetas la diferentes características de tal modo que la estructura final del proyecto sea:

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

La principal ventaja de este tipo de agrupación es la fácil ubicación de los archivos que queramos modificar y también facilitar el acceso al código a los nuevos miembros del equipo ya que en cierta medida es más fácil no tocar partes del código que igual no debemos tocar. También es muy cómodo, si trabajas en Visual Studio para Windows, utilizar la opción "Scope to" para focalizar nuestro trabajo en una sola característica.

### Cómo registrar nuestros páginas y ViewModels

Tenemos dos formas de registrar nuestras páginas y ViewModels en Prism utilizando la opción de genéricos.

* Indicando la Vista y el ViewModel en el método **RegisterForNavigation**, el trabajo estaría realizado, es decir, podemos ubicar nuestras Vistas y ViewModels dónde queramos ya que estamos siendo explícitos y le estamos indicando dónde se encuentran ambos. Es la opción sencilla, incluso más rápido ya que a la hora de resolver no tendrá que utilizar reflexión.

```csharp
containerRegistry.RegisterForNavigation<SalesDashboardView, SalesDashboardViewModel>();
```

* Indicando sólo la Vista en el método **RegisterForNavigation** el contenedor de Prism buscará el ViewModel según la configuración del ViewModelLocator que recordemos que por defecto es:

  * Las Vistas y ViewModels deben estar en el mismo ensamblado.
  * Los ViewModels deben estar en el espacio de nombres de **ViewModels**.
  * Las Vistas en el espacio de nombres **Vistas**.
  * El nombre de los ViewModels debe ser el mismo que las vistas pero acabado en ViewModel.

```csharp
containerRegistry.RegisterForNavigation<SalesDashboardView>();
```

> Por lo que deberemos modificar el comportamiento del ViewModelLocator que viene por defecto en Prism.

### Cómo modificar el ViewModelLocator

En el archivo de aplicación cuando heredamos de la clase abstracta **PrismApplication** tuvimos que implementar los métodos *OnInitialized* y *RegisterTypes*. Pero no son los únicos métodos que podemos sobreescribir y Prism nos ofrece uno en concreto para que podamos sobreescribir el comportamiento por defecto del ViewModelLocator. Este método es: **ConfigureViewModelLocator** y debemos establecer al ViewModelLocationProvider el Resolver por defecto por lo que nuestro código quedaría de la siguiente manera.

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

> Resumen: si cuando registramos nuestras Vistas indicamos el ViewModel no hace falta hacer mucho más para poder trabajar con feature folders pero si eres de los que te gusta utilizar el ViewModelLocator y no especificar el ViewModel al registrar la Vista esta es una opción interesante.