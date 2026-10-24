---
title: Proveedor de cultura personalizado en una aplicación ASPNet Core
date: 2017-01-31
topic: aspnet
published: false
---

Dentro del ensamblado Microsoft.AspNetCore.Localization existe una clase base llamada **RequestCultureProvider** que implementa a su vez la interface **IRequestCultureProvider**, lo que quiere decir que podemos crear nuestros propios proveedores de cultura.

Haciendo un poco de memoria, existen tres proveedores por defecto, **QueryStringRequestCultureProvider**, **CookieRequestCultureProvider**, **AcceptLanguageHeaderRequestCultureProvider** y otro que, aunque no está entre los de por defecto, sí está implementado: **RouteDataRequestCultureProvider**.

El ejemplo que se me ocurre para ver cómo crear un proveedor de cultura personalizado:

* Los usuarios de mi aplicación pueden ver la aplicación en dos culturas (es y en).
* Todos los usuarios pertenecen a una empresa y es la empresa la que dicta la configuración regional, es decir, el formato: el usuario puede elegir la cultura de la interfaz de usuario (UICulture) y la empresa a la que pertenece tiene asignada una cultura.

```csharp
public class MyRequestCultureProvider : CookieRequestCultureProvider
{
    public MyRequestCultureProvider()
    {
        CookieName = "Culture";
    }

    public override async Task<ProviderCultureResult> DetermineProviderCultureResult(HttpContext httpContext)
    {
        var result = await base.DetermineProviderCultureResult(httpContext);
        IList<StringSegment> cultures = result.Cultures;

        var companyHeader = httpContext.Request.Cookies.SingleOrDefault(p => p.Key == "Company");
        if (companyHeader.Key != null && companyHeader.Value == "666")
        {
            cultures.Clear();
            cultures.Add("en-US");
        }

        return await Task.FromResult(new ProviderCultureResult(result.Cultures, result.UICultures));
    }
}
```