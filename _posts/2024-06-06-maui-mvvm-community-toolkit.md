---
layout: post
title: .NET MAUI MVVM con Community Toolkit 101
published: true
---

# ¿Cómo puedo implementar el patrón MVVM con CommunityToolkit?

En el [post anterior](https://mookiefumi.com/2024-06-04-maui-mvvm) en el que hacía una pequeña introducción al patrón MVVM comenté que había 2 formas de implementar dicho patrón, una en "crudo" que es la que mostré en dicho post y otra por ejemplo la que nos ofrece el **Community Toolkit para .NET**.

En este post veremos los pasos necesarios para implementar dicho patrón a través de este llamado "kit de herramientas" e intentaré ir resumiento es lo que nos aporta si lo incluímos en nuestro proyecto.

La base del código será la misma que en el ejemplo anterior y lo que haré literalmente será sustituir una implementación por otra y dejaré todas las modificaciones en una rama distinta para que se vean las diferencias de forma explícita. Al final del post dejará el enlace al repositorio en GitHub.

## Pasos a seguir

* Deberemos añadir el [paquete nuget CommunityToolkit.Mvvm](https://www.nuget.org/packages/CommunityToolkit.Mvvm) en nuestro proyecto
* Nuestro **BaseViewModel** debe heredar de [**ObservableObject**](https://learn.microsoft.com/en-us/dotnet/communitytoolkit/mvvm/observableobject) que es la clase base que implementa la interface INotifyPropertyChanged.
* Las **propiedades** de nuestros ViewModels en el set deben llamar al método **SetProperty**, el cual es un método que nos ayuda a establecer los valores y generar de forma automática los eventos de cambios.
* Los **comandos** de nuestros ViewModels deberemos cambiarlos a [RelayCommand, RelayCommand<T>](https://learn.microsoft.com/es-es/dotnet/communitytoolkit/mvvm/relaycommand), [AsyncRelayCommand o AsyncRelayCommand<T>](https://learn.microsoft.com/es-es/dotnet/communitytoolkit/mvvm/asyncrelaycommand) que son implementaciones de ICommand que exponen un método o un delegado a la View de forma síncronza o asíncrona según nuestras necesidades.

Viendo el código, la verdad, hasta ahora mismo hemos ganado relativamente poco, quizás lo más llamativo que veo es que nuestros comandos ahora están tipados y no nos vemos obligados a hacer cast del object.

```csharp
//Antes
GoToDetailCommand = new Command(async (param) => await GoToDetail((Launch)param));

//Ahora (seguir leyendo ;))
GoToDetailCommand = new AsyncRelayCommand<Launch>((param) => GoToDetail(param));
```

Lo que siempre me ha terminado cansando ha sido la cantidad de código que hay que generar para implementar este patrón en nuestros ViewModels, un campo privado que se maneja desde la propiedad pública y la verdad, da igual que tengamos helpers en el IDE que nos ayuden a generarlas pero al final la cantidad de código hace que muchas veces nuestras clases tengan un número elevado de líneas y soy de los que se niega en rotundo a tenerlas en regiones o similares.

### Ahorranos escribir tanto código para definir nuestras propiedades y nuestros comandos

Aquí aparece como actor principal el attributo [ObservableProperty](https://learn.microsoft.com/en-us/dotnet/communitytoolkit/mvvm/generators/observableproperty) el cual permite generar propiedades observables a partir de campos anotados y el objetivo es reducir la cantidad de código necesario para generar nuestras propiedades observables.

* Debemos decorar nuestras propiedades observables con el atributo ObservableProperty
  * El naming de nuestras propiedades observables deben usar el patrón "lowerCamel", "_lowerCamel" para evitar colisiones con las propiedades generadas. Si no sigues esta "recomendación" tendrás el aviso en el IDE ["Error del kit de herramientas de MVVM MVVMTK0014"](https://learn.microsoft.com/es-es/dotnet/communitytoolkit/mvvm/generators/errors/mvvmtk0014).
* Nuestros ViewModels deberán tener el modificador partial ya que el compilador esta generando ese código por debajo con el mismo nombre de nuestro de ViewModel.

  ```csharp
  //Antes
  private ObservableCollection<GetLaunchesResponse> _launchesResponse;
  public ObservableCollection<GetLaunchesResponse> LaunchesResponse
  {
      get { return _launchesResponse; }
      set
      {
          if (_launchesResponse != value)
          {
              _launchesResponse = value;
              OnPropertyChanged();
          }
      }
  }

  //Ahora
  //Nos generará una propiedad pública llamada LaunchesResponse
  [ObservableProperty]
  private ObservableCollection<GetLaunchesResponse> _launchesResponse;
  ```

Otro actor principal que aparece es el atributo [**RelayCommand**](https://learn.microsoft.com/en-us/dotnet/communitytoolkit/mvvm/generators/relaycommand) el cual nos permite reducir el código que tenemos que escribir para generar nuestros comandos.

  * Este atributo adminite como parámetros entre otros:
    * **AllowConcurrentExecutions**
      * ¿Quieres evitar o permitir que tu comando se ejecute de forma concurrente?
    * **CanExecute**
      * ¿Necesitamos que tu comando se ejecute en determinadas condiciones?

  ```csharp
  //Nos generará un comando público llamado GoToDetailCommand
  [RelayCommand]
  private async Task GoToDetail(Launch launch)
  {
      await _navigationService.NavigateToAsync(nameof(LaunchDetailView), launch);
  }
  ```

[Dejo por aquí el repositorio en GitHub](https://github.com/MookieFumi/SpaceX-MAUI/tree/internal/communitytoolkit-mvvm) por si quieres echarle un vistazo y tener todo el código de ejemplo.

## Enlaces de interés

| Info    | Enlace |
| -------- | ------- |
| CommunityToolkit.Mvvm en Microsoft Learn | https://learn.microsoft.com/es-es/dotnet/communitytoolkit/mvvm/   |
| Repo en GitHub de CommunityToolkit.Mvvm | https://github.com/CommunityToolkit/dotnet   |