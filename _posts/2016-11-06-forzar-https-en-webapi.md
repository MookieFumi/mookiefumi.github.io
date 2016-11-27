---
layout: post
title: Forzar Https en nuestra WebApi
subtitle: Como forzar Https en los controladores de nuestras WebApi
published: false
---

El modo de autenticación de nuestra WebApi es autenticación básica, y como he comentado este tipo de autenficación "sólo es válida" si va con Https. Para ponernos en contexto y si mal no recuerdo, a día de hoy, Azure de forma predeterminada, tiene asegurado el dominio *.azurewebsites.net con un certificado SSL, por lo que cada sitio web levantemos estará disponible tanto por Http como por Https. Pero ¿Cómo podemos asegurarnos de que nuestros clientes usarán siempre nuestra API mediante Https?

Antes de seguir

```c#
public class RequireHttpsMessageHandler : DelegatingHandler {

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