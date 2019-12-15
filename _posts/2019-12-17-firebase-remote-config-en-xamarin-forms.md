---
layout: post
title: Firebase Remote Config en Xamarin Forms
published: true
---

## Firebase Remote Config en Xamarin Forms

### Introducción

Uno de los servicios más interesantes que ofrece Firebase es [Remote Config](https://firebase.google.com/docs/remote-config), es un servicio en la nube mediante el cual podemos cambiar el comportamiento y aspecto de nuestra aplicación sin necesidad de generar una nueva versión de la app y sin tener que distribuirla.

En resumen, creamos unos valores predeterminados en la aplicación que podemos sobreescribirlos mediante este servicio, y como posibles casos de uso:

* Si queremos activar o desactivar características de la aplicación (*este será el ejemplo con el que vamos a hacer este post*).
![Firebase Remote Config Example](images/2019-12-15-17.10.14.png)
![Firebase Remote Config Example](images/2019-12-15-17.10.58.png)
* Si queremos mostrar más o menos información en las pantallas de nuestra app.
* Si queremos modificar el tema o los colores de nuestra app.

> En nuestro caso hemos utilizado Firebase Remote Config para que nuestro equipo de QA probara la aplicación contra diferentes APIs (entornos), ya que necesitábamos poder añadir, modificar o eliminar entornos sin tener que publicar la app.

En la [documentación oficial](https://firebase.google.com/docs/remote-config/use-cases) puedes encontrar diferentes casos de uso avanzados como:

* Lanzar nuevas características mediante despliegue porcentual.
* Definir banners promocionales específicos de la plataforma y de la localidad.
* Probar nuevas características para un grupo de prueba limitado.

> Es decir, mediante Firebase Remote Config podremos cambiar el comportamiento de nuestro aplicación ya que podremos mostrar o no el detalle del jugador seleccionado sin necesidad de compilar ni publicar la aplicación.

### Configurar Firebase Remote Config

Podemos configurar Firebase Remote Config desde el portal de Firebase <https://console.firebase.google.com/project/Your-Firebase-Project/config> y es un proceso extremadamente sencillo ya que contamos con una interfaz gráfica muy completa. Para ello, añadimos una clave de parámetro y un valor predeterminado que puede ser por ejemplo un json (la interfaz gráfica tiene un asistente para validar el json). En nuestro caso la clave de valor será **Features** y el valor predeterminado el siguiente json:

```json
{
    "ShowPlayerDetail": false
}
```

> En este caso en concreto definimos una clave llamada **ShowPlayerDetail** para mostrar o no el detalle de un jugador en nuestra app.

### Añadir a nuestros proyectos Android e iOS los valores por defecto

En el caso de **Android** debemos añadir un archivo xml como **Build Action -> AndroidResource** con el siguiente contenido.

```xml
<?xml version="1.0" encoding="utf-8"?>
<defaultsMap>
    <entry>
        <key>Features</key>
        <value>{ "ShowPlayerDetail" : false }</value>
    </entry>
</defaultsMap>
```

En el caso de **iOS** debemos añadir un archivo plist como **Build Action -> BundleResource** con la misma clave (**Features**) y el mismo contenido que el de Android.

### Añadir paquetes nuget a nuestros proyectos

Aunque existe un paquete nuget para trabajar con Firebase Remote Config desde nuestro proyecto .Net Standard yo no he conseguido hacerlo funcionar por lo que he tenido que crear una interfaz e implementar en las diferentes plataformas apoyándome en el uso de diferentes paquetes nuget.

Para **Android** el paquete nuget que he utilizado es:

* [Xamarin.Firebase.RemoteConfig](https://github.com/xamarin/GooglePlayServicesComponents) (71.1610.0).

Para **iOS** el paquete nuget que he utilizado es:

* [Xamarin.Firebase.iOS.RemoteConfig](https://github.com/xamarin/GoogleApisForiOSComponents) (3.0.0).

> Con versiones superiores a la versión 3.0.0 de *(Xamarin.Firebase.iOS.RemoteConfig)* he tenido muchos problemas por lo que NO he actualizado a la última versión.

### Crear interfaz e implementar en plataforma

Y para manejar ambos paquetes desde nuestro proyecto .NetStandard definimos una interfaz para recuperar y activar los valores en Firebase (*FetchAndActivateAsync*) y otra para leer (*GetAsync*) el valor de la clave y convertirlo en nuestro objeto.

> Ojo! Es una implementación para este ejemplo en concreto y en algunos casos es interesante por una lado recuperar los valores del servicio (Fetch) y por otro activarlos (Activate) y dependerá un poco del escenario que queramos realizar.

```csharp
public interface IRemoteConfigurationService
{
    Task FetchAndActivateAsync();
    //Utilizamos un genérico para fijar el objeto de retorno del valor que solicitamos
    Task<TInput> GetAsync<TInput>(string key);
}
```

Esta es la implementación en **Android**.

```csharp
public class MyRemoteConfigurationService : IRemoteConfigurationService
{
    public MyRemoteConfigurationService()
    {
        //Establecemos los valores por defecto
        FirebaseRemoteConfig.Instance.SetDefaults(Resource.Xml.RemoteConfigDefaults);
    }

    public async Task FetchAndActivateAsync()
    {
        //Inicia la recuperación de la configuración
        await FirebaseRemoteConfig.Instance.FetchAsync();

        //Activa la configuración recuperada
        FirebaseRemoteConfig.Instance.ActivateFetched();
    }

    public async Task<TInput> GetAsync<TInput>(string key)
    {
        var settings = FirebaseRemoteConfig.Instance.GetString(key);

        return await Task.FromResult(Newtonsoft.Json.JsonConvert.DeserializeObject<TInput>(settings));
    }
}
```

> El método ActivateFetched está deprecado en versiones superiores (utilizar Activate).

Esta es la implementación en **iOS**.

```csharp
public class MyRemoteConfigurationService : IRemoteConfigurationService<RemoteConfiguration>
{
    public MyRemoteConfigurationService()
    {
        //Establecemos los valores por defecto
        RemoteConfig.SharedInstance.SetDefaults("RemoteConfigDefaults");
    }

    public async Task FetchAndActivateAsync()
    {
        var status = await RemoteConfig.SharedInstance.FetchAsync(0);
        if (status == RemoteConfigFetchStatus.Success)
        {
            RemoteConfig.SharedInstance.ActivateFetched();
        }
    }

    public async Task<TInput> GetAsync<TInput>(string key)
    {
        var settings = RemoteConfig.SharedInstance[key].StringValue;
        return await Task.FromResult(Newtonsoft.Json.JsonConvert.DeserializeObject<TInput>(settings));
    }
}
```

### Ejecutando nuestro ejemplo en ambas plataformas

En el ejemplo podemos ver como desactivamos la opción de ver el detalle de un jugador en Firebase Remote Config y como en ambas plataformas y sin necesidad de compilar ni distribuir nuestra app, el detalle del jugador no se muestra.

<iframe width="560" height="315" src="https://www.youtube.com/embed/fMdo_CLRJmI" frameborder="0" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

### Enlaces de interés

* El repositorio está alojado en Github [Github](https://github.com/MookieFumi/XF-Firebase-RemoteConfig).
* [Casos de uso](https://firebase.google.com/docs/remote-config/use-cases).
* [Estrategias de carga](https://firebase.google.com/docs/remote-config/loading).
* [Throttling](https://firebase.google.com/docs/remote-config/use-config-android#throttling).
