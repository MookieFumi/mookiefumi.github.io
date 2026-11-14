---
title: "El token caducó hace cinco minutos y tu API lo sigue aceptando: Broken Authentication, el riesgo número dos de OWASP"
subtitle: Lo que le toca validar a tu API cuando el login lo hace otro
description: "Broken Authentication (OWASP API2:2023) en ASP.NET Core: qué valida JwtBearer por defecto, el margen de cinco minutos de ClockSkew, cómo se rompe la validación de audiencia y emisor, por qué no aceptar tokens en la URL ni usar API keys para usuarios, y los tests que lo vigilan."
date: 2027-01-05
topic: aspnet
series: owasp-api
published: false
---

El 31 de julio de 2019, Insomnia Security avisó a Auth0 de un fallo en la validación de JWT de su API de autenticación. [Según la propia Auth0](https://auth0.com/blog/insomnia-security-disclosure/), una parte antigua de su código no usaba su implementación estándar de JWT y comparaba el algoritmo del token sin distinguir mayúsculas y minúsculas, así que un token que decía ir sin firmar acababa en el verificador de tokens sin firma. Lo corrigieron en producción ese mismo día.

Si a una empresa que vive de la autenticación se le coló un camino así, a cualquier API se le puede colar. Otros fallos son menos llamativos y vienen de serie: con la configuración por defecto, una API de ASP.NET Core sigue aceptando un token hasta cinco minutos después de que caduque. Lo he comprobado con un test.

## Qué es API2 y qué parte le toca a tu API

El segundo riesgo del [OWASP API Security Top 10](https://owasp.org/API-Security/editions/2023/en/0xa2-broken-authentication/) de 2023 es *Broken Authentication*. OWASP lo califica de fácil de explotar y de común, con un impacto grave: quien lo aprovecha puede hacerse con cuentas ajenas, y el sistema difícilmente distingue sus acciones de las del usuario legítimo.

La lista de síntomas es larga. Una parte va de contraseñas y del login: credential stuffing, fuerza bruta sin bloqueo, contraseñas débiles o mal guardadas. Si delegas el login en un proveedor de identidad (Entra ID, Keycloak, Auth0...), esa parte es suya. Lo que queda en tu API son estos puntos de la misma lista:

- Sends sensitive authentication details, such as auth tokens and passwords in the URL.
- Doesn't validate the authenticity of tokens.
- Accepts unsigned/weakly signed JWT tokens (`{"alg":"none"}`)
- Doesn't validate the JWT expiration date.

En el apartado de prevención, OWASP pide entender qué hace cada mecanismo de autenticación y lo resume en una frase: "OAuth is not authentication, and neither are API keys".

En este post me quedo con lo que le toca a la API. Con la forma de autenticar que usa [entry-hub](https://github.com/MookieFumi/entry-hub), la API de reservas de esta serie, eso es validar bien los JWT.

## Qué valida JwtBearer por defecto

La [documentación de ASP.NET Core](https://learn.microsoft.com/aspnet/core/security/authentication/configure-jwt-bearer-authentication) dice que una API tiene que validar del todo los tokens: la firma, el emisor (`iss`), la audiencia (`aud`) y la caducidad. Si algo de eso falla, la respuesta tiene que ser un `401`.

`AddJwtBearer` hace las cuatro cosas sin que se lo pidas. En entry-hub la configuración sale del apartado `Authentication:Schemes:Bearer`, que es donde la deja `dotnet user-jwts`:

```csharp
services
    .AddAuthentication()
    .AddJwtBearer(options =>
    {
        options.MapInboundClaims = false;
        options.TokenValidationParameters.NameClaimType = "sub";
        options.TokenValidationParameters.RoleClaimType = "role";
    });
```

El emisor válido, las audiencias y la clave de firma vienen de configuración. Con eso, un token sin firma, firmado con otra clave, para otra audiencia o de otro emisor recibe un `401`.

La caducidad tiene un matiz. `TokenValidationParameters` tiene una propiedad `ClockSkew`, el margen que se concede por si los relojes del proveedor de identidad y de la API no van sincronizados. Su valor por defecto, `TokenValidationParameters.DefaultClockSkew`, es de 300 segundos. Un token que caducó hace cuatro minutos sigue siendo válido.

Lo comprobé en entry-hub con un token caducado hace cuatro minutos contra `GET /api/v1/bookings/mine`: respondió `200`. Con uno caducado hace seis, `401`.

Con los relojes sincronizados por NTP, cinco minutos me parece mucho margen. En entry-hub lo he dejado en 30 segundos:

```csharp
// By default an expired token is still accepted for five more minutes (TokenValidationParameters
// .DefaultClockSkew). Thirty seconds covers the clock drift between servers without that window.
options.TokenValidationParameters.ClockSkew = TimeSpan.FromSeconds(30);
```

Si tus tokens duran una hora, cinco minutos más pueden parecer poco. Si duran cinco minutos porque tienes refresh tokens, el margen por defecto duplica su vida.

## Cómo se rompe la validación

Salvo ese margen, los valores por defecto son seguros, y los problemas suelen venir de tocarlos. Un caso típico: un token no pasa la validación en un entorno porque su audiencia o su emisor no coinciden con lo configurado, y alguien lo arregla así:

```csharp
options.TokenValidationParameters.ValidateAudience = false;
options.TokenValidationParameters.ValidateIssuer = false;
```

Con esas dos líneas, la API acepta cualquier token firmado con una clave en la que confíe, aunque se emitiera para otra API o desde otro emisor. Si tus entornos o tus APIs comparten clave de firma, un token emitido para una sirve en las demás, porque la audiencia era lo único que decía "este token es para mí".

Lo mismo vale para la firma. Si un test o una prueba en local te pide aceptar tokens sin firmar, haz que el test genere tokens firmados con una clave de prueba, como hace entry-hub, en lugar de abrir la validación.

## Tokens en la URL

entry-hub tiene un endpoint de Server-Sent Events, `GET /api/v1/rooms/{id}/occupancy`, que emite cada pocos segundos si una sala está libre u ocupada. En un navegador, lo natural sería consumirlo con `EventSource`. El problema es que [la API de Server-Sent Events del navegador no deja poner cabeceras](https://learn.microsoft.com/aspnet/core/signalr/authn-and-authz), así que el token no puede ir en `Authorization`.

La salida rápida es aceptar el token en la query string. SignalR lo hace con `access_token` precisamente por esa limitación. Pero la propia [documentación de SignalR](https://learn.microsoft.com/aspnet/core/signalr/security#access-token-logging) avisa de que muchos servidores guardan la URL de cada petición en sus logs, y que ASP.NET Core lo hace por defecto, query string incluida:

```text
info: Microsoft.AspNetCore.Hosting.Internal.WebHost[1]
      Request starting HTTP/1.1 GET http://localhost:5000/chathub?access_token=1234
```

Ese token acaba en tus logs, en los del proxy y en cualquier herramienta que los recoja. Por eso OWASP lo incluye entre los síntomas de API2.

entry-hub no acepta tokens en la URL: el stream exige la cabecera `Authorization` como el resto de endpoints. Si un cliente de navegador lo necesita, hay alternativas que mantienen el token en la cabecera. Puede leer el stream con `fetch`, que sí admite cabeceras, o pasar por un backend-for-frontend que añada la cabecera, una opción que menciona la documentación de SignalR con YARP. Si aun así aceptas tokens en la URL, limita qué endpoints los admiten y quita ese parámetro de los logs.

## Las API keys identifican clientes, no usuarios

El último punto de OWASP que le toca a la API:

> API keys should not be used for user authentication. They should only be used for API clients authentication.

Una API key dice qué aplicación llama, pero no qué persona está detrás, y normalmente no caduca sola. Si una API key basta para leer los datos de un usuario, cualquiera que la tenga es ese usuario.

En el [post sobre migrar una API con un gateway](/2026-11-06-migrar-api-sin-que-clientes-se-enteren), la cabecera `X-Api-Key` solo sirve para contar peticiones por cliente en el rate limiting, y quién es el usuario lo sigue diciendo el token.

## Los tests que lo vigilan

La configuración de JwtBearer es de las cosas que nadie mira hasta que algo falla. Así que en entry-hub hay tests que mandan a la API los tokens que debería rechazar y exigen un `401`. Cada caso parte de un token válido y le cambia una cosa:

```csharp
private static readonly Dictionary<string, Func<SecurityTokenDescriptor, SecurityTokenDescriptor>> InvalidTokenFactories = new()
{
    ["Unsigned (alg none)"] = descriptor =>
    {
        descriptor.SigningCredentials = null;
        return descriptor;
    },
    ["Signed with another key"] = descriptor =>
    {
        var otherKey = new SymmetricSecurityKey(SHA256.HashData("someone-else-signing-key"u8));
        descriptor.SigningCredentials = new SigningCredentials(otherKey, SecurityAlgorithms.HmacSha256);
        return descriptor;
    },
    ["Expired one minute ago"] = descriptor => ExpiredAgo(descriptor, TimeSpan.FromMinutes(1)),
    ["For another audience"] = descriptor =>
    {
        descriptor.Audience = "another-api";
        return descriptor;
    },
    ["From another issuer"] = descriptor =>
    {
        descriptor.Issuer = "another-issuer";
        return descriptor;
    },
};

[Theory]
[MemberData(nameof(InvalidTokens))]
public async Task An_invalid_token_is_rejected(string invalidToken)
{
    using var api = await TestApi.StartAsync();
    var token = TestTokens.Sign(InvalidTokenFactories[invalidToken](Employee()));
    using var client = api.ClientWithToken(token);

    var response = await client.GetAsync(ProtectedPath);

    Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
}
```

Sin `SigningCredentials`, `JsonWebTokenHandler` genera un token con `"alg": "none"`, el caso de OWASP. El token "caducado hace un minuto" solo da `401` porque el margen está en 30 segundos. Con el valor por defecto, el test falla.

Hay otros dos tests para que la lista no se pase de estricta: uno comprueba que un token válido recibe un `200` y otro que un token caducado hace diez segundos, dentro del margen, se sigue aceptando.

Para comprobar que los tests sirven, desactivé `ValidateAudience` y `ValidateIssuer` y los ejecuté:

```text
Failed TokenValidationTests.An_invalid_token_is_rejected(invalidToken: "From another issuer")
Expected: Unauthorized
Actual:   OK
Failed TokenValidationTests.An_invalid_token_is_rejected(invalidToken: "For another audience")
Expected: Unauthorized
Actual:   OK
```

Si alguien hace ese "arreglo" algún día, el PR no pasa.

## Resumiendo

- Broken Authentication es el segundo riesgo del OWASP API Security Top 10. Si el login lo hace un proveedor de identidad, a tu API le toca validar bien los tokens.
- `AddJwtBearer` valida firma, emisor, audiencia y caducidad por defecto, pero da cinco minutos de margen a los tokens caducados. Bájalo con `ClockSkew`.
- No desactives `ValidateAudience` ni `ValidateIssuer` para que un token pase. Corrige la configuración o el token.
- No aceptes tokens en la URL salvo que no quede otra, porque acaban en los logs.
- Las API keys identifican aplicaciones, no usuarios.
- Un test que manda tokens inválidos y exige `401` evita que alguien rompa la validación sin darse cuenta.

Los tests están en [entry-hub](https://github.com/MookieFumi/entry-hub).
