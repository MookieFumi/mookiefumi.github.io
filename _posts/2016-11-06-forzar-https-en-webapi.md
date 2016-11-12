---
layout: post
title: Forzar Https en nuestra WebApi
subtitle: Como forzar Https en los controladores de nuestras WebApi
published: false
---

En este artículo quiero mostrar como forzamos a los controladores de nuestra WebApi a utilizar Https aprovechando los puntos de extensibilidad que nos ofrece WebApi.

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