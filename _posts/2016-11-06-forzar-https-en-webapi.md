---
layout: post
title: Forzar Https en nuestra WebApi
subtitle: Como forzar Https en los controladores de nuestras WebApi
published: true
---

El modo de autenticación de nuestra WebApi es autenticación básica, y como he comentado este tipo de autenficación "sólo debe usarse" si va acompañada del protocolo Https. El motivo no es otro ya que la autenticación básica no deja ser una combinación del usuario y la contraseña en Base64. Si por ejemplo nos fijamos en la siguiente cabecera de autenticación: **Basic TW9va2llRnVtaTpNeVBhc3N3b3Jk** y la decodificamos podemos ver su contenido sin ningún tipo de problema: **MookieFumi:MyPassword.**

Para ponernos en contexto y si mal no recuerdo, a día de hoy, Azure de forma predeterminada, tiene asegurado el dominio *.azurewebsites.net con un certificado SSL, por lo que cada sitio web que levantemos estará disponible tanto por Http como por Https. Pero ¿Cómo podemos asegurarnos de que nuestros clientes usarán siempre nuestra API mediante Https? Uno de lops mecanismos que tiene WebApi son los DelegatingHandler.

```c#
public class ForceHttpsMessageHandler : DelegatingHandler {

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) {

        if (request.RequestUri.Scheme != Uri.UriSchemeHttps) {

            var forbiddenResponse = request.CreateResponse(HttpStatusCode.Forbidden);
            forbiddenResponse.ReasonPhrase = "SSL Required";
            return Task.FromResult<HttpResponseMessage>(forbiddenResponse);
        }

        return base.SendAsync(request, cancellationToken);
    }
}
```