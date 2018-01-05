---
layout: post
title: Internacionalizar una aplicación ASPNet Core
published: true
---
# Internacionalizar una aplicación ASPNet Core

## Introducción, conceptos

* **Internacionalización (*I18n*)**. Es el proceso de diseñar aplicaciones que soporten distintos idiomas y culturas/ regiones.

* **Localización (*L10n*)**. Es el proceso de preparar/ **adaptar** nuestra aplicación a una cultura/ región específica. *Según la Wikipedia también se le puede denominar regionalización.*

* **Globalización (*G11n*)**. Es una convección creada por IBM y Sun Microsystem para cubrir tanto la internacionalización como la localización.

> Lo que está entre paréntesis (I18n, L10n, G11n) se denominan numerónimos que no es otra cosa que una palabra que contiene números con el fin de abreviar un término o concepto.

<https://es.wikipedia.org/wiki/Internacionalizaci%C3%B3n_y_localizaci%C3%B3n>

## Internacionalización en NET

> La manera que tenemos en .NET de manejar diferentes culturas/ regionar/ idiomas es a través de las propiedades CurrentCulture y CurrentUICulture que se encuentran en System.Threading.Thread.CurrentThread, y tenemos que tener absolutamente claro la diferencia existente entre ambas. Con **Culture establecemos la cultura en tiempo de ejecución** y sirve principalmente para dar formato a fechas, números, símbolos de moneda, etc. y con **UICulture establecemos la cultura de la interfaz de usuario**, es decir, para traducir nuestros recursos.

## Internacionalización en NET Core

NET Core tiene soporte para la internacionalización a través de un middleware dentro del ensamblado Microsoft.Extensions.Localization, disponible en [nuget](https://www.nuget.org/packages/Microsoft.Extensions.Localization) y al ser un middleware primero debemos añadirlo como dependencia en nuestra clase Startup.

```csharp
public void ConfigureServices(IServiceCollection services)
{
    services.AddLocalization(options =>
    {
        //Podemos definimos la ruta/ ubicación de nuestros recursos, por defecto es la raíz
        options.ResourcesPath = "Resources";
    });
}
```

Una vez añadida la dependencia debemos añadir el middleware al pipeline de nuestra aplicación y eso lo hacemos en el método Configure del Startup. **Ojo! Es importante introducir este middleware justo antes que otros middlewares que dependan de la cultura como pueda ser el de MVC**.

```csharp
public void Configure(IApplicationBuilder app, IHostingEnvironment env)
{
    var supportedCultures = new List<CultureInfo>
    {
        new CultureInfo("es-ES"),
        new CultureInfo("en-US")
    };
    app.UseRequestLocalization(new RequestLocalizationOptions
    {
        //En este caso la cultura por defecto será es-ES
        DefaultRequestCulture = new RequestCulture(supportedCultures.First()),
        SupportedCultures = supportedCultures,
        SupportedUICultures = supportedCultures
    });

    app.UseMvcWithDefaultRoute();
}
```

## Uso de los recursos

Para utilizar los recursos dentro de un controlador debemos crear dentro de la carpeta de recursos (*Resources siguiendo con el ejemplo anteriomente comentado*) uno con el nombre del controlador (*incluido el espacio de nombres sin ensamblado*), es este caso de ejemplo sería:

```script
Features.Home.HomeController.es.resx
Features.Home.HomeController.en.resx
```

Durante la configuración hemos especificado una cultura por defecto para nuestras peticiones por lo que el nombre del archivo de recursos para la cultura por defecto *(en esta caso es-ES)* puede no llevar el sufijo de la cultura.

```script
Features.Home.HomeController.resx
Features.Home.HomeController.en.resx
```

Y en el controlador inyectar **IStringLocalizer**. ¿Qué es IStringLocalizer? Es un artefacto creado para mejorar la productividad al desarrollar aplicaciones localizadas y utiliza tanto el ResourceManager como ResourceReader para proporcionar recursos en tiempo de ejecución. Si el localizador no encuentra valor para la clave solicitada lo que devuelve es la misma clave solicitada.

```csharp
public HomeController(IStringLocalizer<HomeController> localizer)
{
    _localizer = localizer;
    var localizedValue = _localizer["Home"];
}
```

En el controlador también podemos inyectar **IHtmlLocalizer** que es la implementación ad hoc para los recursos que contienen código HTML y lo que hace es escapar la salida HTML.

> También es importante conocer que podemos inyectar en el controlador la factoría IStringLocalizerFactory que es la encargada de conseguir/ obtener estos localizadores. Personalmente me gusta más la opción de IStringLocalizer/ IHtmlLocalizer ya que así no tenemos que utilizar la llamada al método Create de la factoria. A mi personalmente me gusta más la idea de ir por el genérico de IStringLocalizer, me resulta más cómodo y requiere un número menor de líneas de código.

Conclusiones.

* ¿Qué no me gusta de esto?
  * Que no tengo un repositorio central de recursos.
  * Que ahora tengo que utilizar los recursos con magic strings, no como antes que existía una clase autogenerada para poder acceder a los recursos.

La solución a la primera es relativamente sencilla. El equipo de MS propone crearnos una clase Dummy llamada SharedResource y nuestros recursos SharedResource.en.resx, SharedResource.es.resx.

```csharp
// Dummy class to group shared resources
public class SharedResource
{
}

public HomeController(IStringLocalizer<SharedResource> sharedLocalizer)
{
    _sharedLocalizer = sharedLocalizer;
}
```

La solución a la segunda (magic strings) es menos trivial y lo dejaré para un artículo posterior, en el que mostraré una primera aproximación que implicará una clase que contenga todas las keys utilizadas en los recursos y un par de tests que se encargarán de chequear que todo está a nivel.

## Proveedores de cultura

Ahora bien **¿De cuantas opciones disponemos para hacer establecer la cultura? ¿Cuántos proveedores de cultura tenemos disponibles?** El middleware de localización (*Microsoft.Extensions.Localization*) utiliza 3 proveedores por defecto:

> *Ni que decir tiene y vuelvo a insistir en ello que no es lo mismo Culture (formato fechas, decimales, símbolo moneda) que UICulture (traducciones) y pongo un ejemplo muy concreto: Mi empresa trabaja en dolares (Culture en-US) y yo puedo ver la aplicación en español o inglés.*

* Mediante **query string**.

Si en la query string indicamos sólo una de las dos (culture/ ui-culture) nos cambia tanto Culture como UICulture por lo que si queremos que sean diferentes debemos indicar ambas en la query string.

```script
//Los símbolos de moneda, formatos de número y fecha serán en-US salvo los recursos que serán es-ES
?culture=en-US&ui-culture=es-ES

//Tanto Culture como UICulture serán en-US
?culture=en-US

//Tanto Culture como UICulture serán es-Es
?ui-culture=es-ES
```

El nombre de los parámetros de la query string destinados a Culture y UICulture pueden modificarse en las opciones del proveedor mediante la propiedad QueryStringKey y UIQueryStringKey.

```csharp
var queryStringRequestCultureProvider = options.RequestCultureProviders
    .OfType<QueryStringRequestCultureProvider>()
    .First();
queryStringRequestCultureProvider.QueryStringKey = "c";
queryStringRequestCultureProvider.UIQueryStringKey = "uic";
```

* Mediante **cookie**

Un modo más persistente es enviar en la request la cultura mediante una cookie. El nombre por defecto de la cookie de cultura es ".AspNetCore.Culture" pero este nombre puede sobreescribirse durante la configuración.

```csharp
var cookieProvider = localizationOptions.RequestCultureProviders
    .OfType<CookieRequestCultureProvider>()
    .First();
cookieProvider.CookieName = "Culture";
```

```script
c=en-US|uic=es-ES

c=en-US

uic=en-US
```

* Mediante la cabecera **Accept-Language**

    Este proveedor lee la cultura a través la cabecera Accept-Language que ha sido enviada en la petición. **Cuenta con un handicap importante y es que no se puede especificar diferente cultura para Culture y UICulture**.

```csharp
Accept-Language:en-US,en;q=0.8,es;q=0.6;
```

El orden de estos proveedores es importante ya que el primero es el que prevalece (QueryStringRequestCultureProvider, CookieRequestCultureProvider, AcceptLanguageHeaderRequestCultureProvider) pero está claro que podemos cambiar este orden, eliminar alguno si procede o crearnos el nuestro personalizado ya que podemos implementar la interfaz IRequestCultureProvider o la clase RequestCultureProvider. Pero esto en concreto, lo dejaré para para un artículo posterior.

```csharp
//Eliminar el proveedor de cultura a través de la cabecera Accept-Language
private static void RemoveAcceptLanguageProvider(RequestLocalizationOptions options)
{
    var acceptLanguageProvider = options.RequestCultureProviders
        .OfType<AcceptLanguageHeaderRequestCultureProvider>()
        .First();
    options.RequestCultureProviders.Remove(acceptLanguageProvider);
}
```

También existe otro proveedor que aunque no se encuentra entre los de por defecto es muy chulo, es el llamado **RouteDataRequestCultureProvider**, que como por su nombre podemos sospechar la cultura pasará a ser parte de la ruta <http://localhost:5000/es-ES/Home/About>. Para añadirlo bastaría con incluirlo entre los proveedores disponibles y **modificar el enrutado de nuestra aplicación**, ya sea por la ruta por defecto (Convention routing) o por atributo (Attribute routing).

```csharp
var requestProvider = new RouteDataRequestCultureProvider();
localizationOptions.RequestCultureProviders.Insert(0, requestProvider);
```

> Using URL parameters is one of the approaches to localisation Google suggests as it is more user and SEO friendly than some of the other options.

## Otras aspectos interesantes que hay que comentar

* **Localización de vistas**. Tal y como hemos visto, en las vistas podemos inyectar componentes/ colaboradores y en este caso lo que podemos hacer es inyectar un servicio del tipo IViewLocalizer que es el encargado de proporcionar "cadenas localizadas".

```html
@inject IViewLocalizer Localizer

<h2>@Localizer["Home"]</h2>
```

Para poder utilizar esta característica es necesario añadirla como dependencia en nuestra clase  Startup.

```csharp
public void ConfigureServices(IServiceCollection services)
{
    services.AddMvc()
        .AddFeatureFolders()
        .AddViewLocalization();
}
```

* **Cadenas formateadas**. Justo como hemos visto en el punto anterior tenemos soporte para las cadenas formateadas ya que las clases "localizadoras" como último parámetro admiten el típico params object[] que son los argumentos del string.Format.

* **Localización de DataAnnotations**. Si queremos que la localización funcione en los DataAnnotations de nuestros ViewModels debemos añadirla como dependencia en nuestra clase Startup.

```csharp
public void ConfigureServices(IServiceCollection services)
{
    services.AddMvc()
        .AddFeatureFolders()
        .AddViewLocalization()
        .AddDataAnnotationsLocalization(options =>
        {
            //En este caso usamos el almacén centralizado de recursos (SharedResource)
            options.DataAnnotationLocalizerProvider = (type, factory) => factory.Create(typeof(SharedResource));
        });
}
```

## Referencias

* [Repo en Github](https://github.com/MookieFumi/MyNetCoreWebApi)

* <https://docs.microsoft.com/en-us/aspnet/core/fundamentals/localization>

* <https://joonasw.net/view/aspnet-core-localization-deep-dive>

* <https://andrewlock.net/url-culture-provider-using-middleware-as-mvc-filter-in-asp-net-core-1-1-0/>
