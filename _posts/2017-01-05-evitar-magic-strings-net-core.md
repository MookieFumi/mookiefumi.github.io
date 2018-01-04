---
layout: post
title: Evitar magic string al internacionalizar una aplicación ASPNet Core
published: false
---
# Introducción

En el [post sobre la internacionalización de una aplicación ASPNet Core](http://mookiefumi.com/2017-01-04-internacionalizacion-net-core) uno de los puntos más negativos que encontré es el uso de magic strings a la hora de localizar los recursos y en este post/ píldora quiero comentar la apromixamación que se me ha ocurrido para evitarlo.

## ¿Qué son las "magic strings"?

Son valores de cadenas que se especifican directamente dentro del código, y el tufo suele saltar cuando especificas esa "magic string" en más un sitio. Uno de los mecanismos que existen para evitarlo es el uso de constantes.

## Poniendonos en situación

Si nos centramos en el ejemplo de querer localizar algún recurso en el controlador tenemos la opción de inyectar IStringLocalizer/ IHtmlLocalizer y al usarlo tenemos que indicarle que clave es la que queremos recuperar. **Esa clave es nuestra "magic string"**. ¿Qué ocurre si queremos utilizar la clave Home en otro controlador? ¿Qué ocurre si le queremos cambiar el nombre a la clave mientras refactorizamos?

```csharp
public HomeController(IStringLocalizer<SharedResource> localizer)
{
    var localizedValue = localizer["Home"];
}
```

## Evitándo las "magic strings" con el uso de constantes

El mecanismo que suelo utilizar es el uso de una clase estática con constantes públicas y gracias al uso de nameof evito tener que escribir el literal como tal de la clave.

```csharp
public static class SharedResourceKeys
{
    public const string Title = nameof(Title);
    public const string Home = nameof(Home);
}
```

## Queremos asegurarnos que todas las claves existen

Aunque sabemos que con ASPNet Core y el middleware de localización si solicitamos al localizador una clave que no existe nos duelve el mismo valor solicitado (clave), nosotros queremos asegurarnos que todas las constantes tienen su correspondiente recurso, al menos en la cultura por defecto y para ello hemos creado un test para asegurarnos de esto.

En un test, recurrimos a reflexión para recorrernos las propiedades de nuestra clase estática con los flags Public y Static y por cada uno de ellos llamar al localizador y comparar la propiedad ResourceNotFound ya que el tipo que nos devuelve al localizar una clave no es un string sino [LocalizedString](https://github.com/aspnet/Localization/blob/39aa9438abbaac7a25230dec7d2af4da2a8023bf/src/Microsoft.Extensions.Localization.Abstractions/LocalizedString.cs).

```csharp
public class StringLocalizerTest
{
    private readonly TestServer _server;
    private readonly HttpClient _client;

    public StringLocalizerTest()
    {
        var webHostBuilder = new WebHostBuilder()
            .UseStartup<Startup>();
        _server = new TestServer(webHostBuilder);
        _client = _server.CreateClient();
    }

    [Fact]
    public void All_Keys_Exists_In_Resources()
    {
        var localizer = _server.Host.Services.GetService<IStringLocalizer<SharedResource>>();
        var properties = typeof(SharedResourceKeys).GetFields(BindingFlags.Public | BindingFlags.Static);

        foreach (var property in properties)
        {
            Assert.False(localizer[property.Name].ResourceNotFound);
        }
    }
}
```

¿Quién es el encargado de proporcionarnos esta clave?

La clase llamada [ResourceManagerStringLocalizer](https://github.com/aspnet/Localization/blob/51549e8471c247f91d5ac57bd6f8f4c68508854b/src/Microsoft.Extensions.Localization/ResourceManagerStringLocalizer.cs) que es la implementación por defecto de IStringLocalizer la que se encarga de obtener los recursos de archivos resx.

## Queremos asegurarnos que todos los recursos tienen una clave

Igual que nos gusta asegurarnos que todas nuestras claves tengan un recurso al menos en la cultura por defecto, también nos interesa (a nosotros) asegurarnos que todos los recursos tienen una clave (gracias [Sergio Navarro](https://twitter.com/snavarropino)) de tal forma que exista una correlacción 1:1 entre nuestro almacén único de recursos y nuestra clase que almacen las claves.

Los "localizadores" implementan un método llamado GetAllStrings que por devuelve un IEnumerable de LocalizedString por lo que podemos hacer un test similar al anterior para asegurarnos de la correlación 1:1.

```csharp
[Fact]
public void All_Resources_Have_a_Key()
{
    var properties = typeof(SharedResourceKeys).GetFields(BindingFlags.Public | BindingFlags.Static);

    var localizer = _server.Host.Services.GetService<IStringLocalizer<SharedResource>>();
    var items = localizer.GetAllStrings();

    foreach (var item in items)
    {
        Assert.Contains(item.Name, properties.Select(p => p.Name));
    }
}
```

Ahora bien, si ejecutas este test puede ser que salte la excepción **System.Resources.MissingManifestResourceException : No manifests exist for the current culture**. dependiendo de la versión de Microsoft.Extensions.Localization que estés utilizando.

Es un bug abierto que en principio estará resuelto en la versión 2.1.0. Puede leer más información sobre él en [esta issue del repo de Github](https://github.com/aspnet/Home/issues/2630).

```script
System.Resources.MissingManifestResourceException : No manifests exist for the current culture.
   at Microsoft.Extensions.Localization.ResourceManagerStringLocalizer.GetResourceNamesFromCultureHierarchy(CultureInfo startingCulture)
   at Microsoft.Extensions.Localization.ResourceManagerStringLocalizer.<GetAllStrings>d__15.MoveNext()
   at MyWebApi.Test.StringLocalizerTest.All_Resources_Have_a_Key() in line 52

```