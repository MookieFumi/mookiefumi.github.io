---
layout: post
title: Firebase Remote Config en Xamarin Forms
published: true
---

## Firebase Remote Config en Xamarin Forms

### Introducción

Uno de los servicios más interesantes que ofrece Firebase es [Remote Config](https://firebase.google.com/docs/remote-config), es un servicio en la nube mediante el cual podemos cambiar el comportamiento y el aspecto de nuestra aplicación sin necesidad de generar una nueva versión de la app y sin tener que distribuirla.

En resumen, creamos unos valores predeterminados en la aplicación que podemos sobreescribirlos mediante este servicio, y como posibles casos de uso:

* Si nuestros usuarios pueden seleccionar diferentes entornos para trabajar, podemos añadir, editar o incluso eliminarlos.
* Si queremos mostrar más o menos información al usuario en nuestras pantallas.
* Si queremos modificar el tema o los colores de nuestra aplicación en función de la época del año en la que nos encontremos.
* Activar o desactivar features en la aplicación, y este será el ejemplo con el que vamos a hacer este post.

### Configurar Remote Config en Firebase

Podemos configurar Remote Config en <https://console.firebase.google.com/project/Your-Firebase-Project/config> y es extremadamente sencillo y la definimos mediante una clave de parámetro y un valor predeterminado que puede ser por ejemplo un json. En nuestro caso la clave de valor será features y el valor predeterminado el json:

```json
{
  "ShowPlayerDetail": false
}
```

Es decir, mediante esta parametrización podremos cambiar el comportamiento de nuestro aplicación ya que podremos mostrar o no el detalle del jugador seleccionado sin necesidad de compilar ni publicar la aplicación.

### Añadir a nuestros proyectos Android y iOS los valores por defecto

En el caso de **Android** debemos añadir un archivo xml como AndroidResource con el contenido.

```xml
<?xml version="1.0" encoding="utf-8"?>
<defaultsMap>
    <entry>
        <key>Features</key>
        <value>{"ShowPlayerDetail":false</value>
    </entry>
</defaultsMap>
```

En el caso de **iOS** debemos añadir un archivo plist con el mismo contenido que el de Android.

### Añadir paquetes nuget a nuestros proyectos

Aunque existe un paquete nuget para trabajar con Remote Config desde nuestro proyecto .Net Standard yo no he conseguido hacerlo funcionar por lo que he tenido que crear una interfaz e implementar en las diferentes plataformas apoyándome en el uso de diferentes paquetes nuget.

Para **Android** el paquete nuget que he utilizado es:

* Xamarin.Firebase.RemoteConfig (71.1610.0).

Para **iOS** el paquete nuget que he utilizado es:

* Xamarin.Firebase.iOS.RemoteConfig (3.0.0).

> Con versiones superiores a este paquete me ha dado muchos problemas por lo que he actualizado a la última versión.

### Crear interfaz e implementar en plataforma

Y para manejar ambos parquetes desde nuestro proyectos .NetStandard definimos una interfaz para recuperar los valores en Firebase y otra para leer el valor de la clave.

```csharp
//Utilizamos un genérico para asignar el valor de la clave que queramos recuperar
public interface IRemoteConfigurationService<TInput>
{
    Task FetchAndActivateAsync();
    Task<TInput> GetAsync<TInput>(string key);
}
```

Esta es la implementación en **Android**.

```csharp
public class MyRemoteConfigurationService : IRemoteConfigurationService
{
    public MyRemoteConfigurationService()
    {
        //Añadimos los valores por defecto
        FirebaseRemoteConfig.Instance.SetDefaults(Resource.Xml.RemoteConfigDefaults);
    }

    public async Task FetchAndActivateAsync()
    {
        //Inicia la recuperación de la configuración
        await FirebaseRemoteConfig.Instance.FetchAsync(0);

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
        //Añadimos los valores por defecto
        RemoteConfig.SharedInstance.SetDefaults("RemoteConfigDefaults");
    }

    public async Task FetchAndActivateAsync()
    {
        var status = await RemoteConfig.SharedInstance.FetchAsync(60);
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

En el ejemplo podemos ver como se desactiva la opción de ver el detalle de un jugador en ambas plataformas y cambiando el valor desde Firebase Remote Config.

[![Xamarin Forms Firebase RemoteConfig](http://img.youtube.com/vi/fMdo_CLRJmI/0.jpg)](http://www.youtube.com/watch?v=fMdo_CLRJmI)

### Enlaces de interés

* [Estrategias de carga](https://firebase.google.com/docs/remote-config/loading).
