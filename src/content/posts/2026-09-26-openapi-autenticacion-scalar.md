---
title: "El candado que tu documentación OpenAPI no enseñaba"
subtitle: Si la documentación no dice que hace falta un token, el primer 401 lo descubre por ti
description: "JWT Bearer en el documento OpenAPI de .NET 10: esquema de seguridad, candado solo en las operaciones protegidas, tokens de dotnet user-jwts en Scalar y documentación protegida."
date: 2026-09-26
topic: aspnet
series: minimal-apis-dotnet
published: false
---

Abres Scalar en local, eliges `POST /api/v1/rooms`, rellenas el body y le das a enviar. La respuesta es un `401 Unauthorized`, sin body y con una cabecera `WWW-Authenticate: Bearer`. Nada en la página te había dicho que esa operación necesitaba un token, ni dónde ponerlo.

En el [post anterior](/2026-09-25-openapi-scalar-minimal-apis) montamos el documento OpenAPI de [entry-hub](https://github.com/MookieFumi/entry-hub) y lo enseñamos con Scalar. Lo dejamos sin la parte de seguridad, que es la que cuento aquí. Una API protegida le pide dos cosas a su documentación: que diga qué operaciones piden token y deje probarlas con uno, y que el propio documento no quede abierto a cualquiera sin que nadie lo haya decidido.

## Lo justo de la autenticación de entry-hub

entry-hub usa JWT Bearer. Toda la configuración está en `Security/SecurityExtensions.cs`:

```csharp
services
    .AddAuthentication()
    .AddJwtBearer(options =>
    {
        // Keep the claim names of the token ("sub", "role") instead of renaming them to long URIs.
        options.MapInboundClaims = false;
        options.TokenValidationParameters.NameClaimType = "sub";
        options.TokenValidationParameters.RoleClaimType = "role";
    });

services
    .AddAuthorizationBuilder()
    .AddPolicy(Policies.AnyEmployee, policy => policy.RequireRole(Roles.Employee, Roles.Facilities))
    .AddPolicy(Policies.Facilities, policy => policy.RequireRole(Roles.Facilities));
```

Hay dos roles. `Employee` es cualquier persona de la empresa y `Facilities` es el equipo de instalaciones, que además puede crear salas. Las políticas se aplican en los grupos de rutas, como vimos en el [primer post](/2026-09-23-minimal-apis-vertical-slice): todo lo que cuelga de `/rooms` y `/bookings` pide `AnyEmployee`, y crear una sala pide `Facilities`.

`AddJwtBearer` no lleva ni emisor, ni audiencia, ni clave en el código. Los lee de la sección `Authentication:Schemes:Bearer` de la configuración, que es justo donde los escribe `dotnet user-jwts`. Es la herramienta del SDK para crear tokens de desarrollo:

```bash
cd src/EntryHub.Api
dotnet user-jwts create --role Employee --name ana        # prints the token
dotnet user-jwts create --role Facilities --name fran
```

La primera vez, `user-jwts` añade el emisor y las audiencias al `appsettings.Development.json`, que sí está en el repositorio. La clave con la que firma los tokens la guarda en los user secrets de tu máquina, fuera del repositorio. Cada desarrollador tiene la suya y nadie sube una clave por accidente.

Si quieres la parte de OAuth y OpenID Connect con un proveedor de identidad real, está en la [serie de OAuth en microservicios](/2026-08-17-oauth-oidc-keycloak-entra-id). Aquí nos basta con saber que llega un JWT con un rol.

## Declarar el esquema de seguridad

Lo primero es contarle al documento cómo se autentica la API. OpenAPI lo llama esquema de seguridad y va en `components.securitySchemes`. En entry-hub lo añade el mismo transformer de documento que pone el título:

```csharp
document.Components ??= new OpenApiComponents();
document.Components.SecuritySchemes ??= new Dictionary<string, IOpenApiSecurityScheme>();
document.Components.SecuritySchemes[BearerScheme] = new OpenApiSecurityScheme
{
    Type = SecuritySchemeType.Http,
    Scheme = "bearer",
    BearerFormat = "JWT",
    Description = "A JWT with the role Employee or Facilities. In development: dotnet user-jwts create.",
};
```

`Type = Http` con `Scheme = "bearer"` significa una cabecera `Authorization: Bearer <token>`. `BearerFormat` es informativo y dice que el token es un JWT. La descripción la escribimos pensando en quien abre la documentación por primera vez: qué rol necesita y cómo conseguir un token en local.

El generador de .NET no añade este esquema por su cuenta aunque la aplicación use `AddJwtBearer`, así que hay que declararlo a mano.

## El candado solo donde hace falta

Con el esquema declarado, el documento sabe cómo se autentica la API, pero todavía no sabe qué operaciones lo necesitan. Eso es el requisito de seguridad (`security`), que puede ir en el documento entero o en cada operación.

Ponerlo en el documento es una línea, pero entonces toda la API sale con candado. Y en entry-hub hay operaciones públicas: `GET /api/v1/health` responde sin token, y las probes `/health` y `/alive` también. Un candado en la salud le diría a quien lee que necesita un token para algo que no lo pide.

Por eso el requisito va por operación, con un transformer de operación que mira los metadatos del endpoint:

```csharp
// Only the operations that need a token get the lock icon, so health stays visibly public.
options.AddOperationTransformer((operation, context, _) =>
{
    var metadata = context.Description.ActionDescriptor.EndpointMetadata;
    var needsToken = metadata.OfType<IAuthorizeData>().Any() && !metadata.OfType<IAllowAnonymous>().Any();

    if (needsToken)
    {
        operation.Security ??= [];
        operation.Security.Add(new OpenApiSecurityRequirement
        {
            [new OpenApiSecuritySchemeReference(BearerScheme, context.Document)] = [],
        });
    }

    return Task.CompletedTask;
});
```

`RequireAuthorization` deja en el endpoint un metadato que implementa `IAuthorizeData`, también cuando se pone en el grupo, porque los endpoints heredan los metadatos de su grupo. `AllowAnonymous` deja un `IAllowAnonymous`. Si hay lo primero y no lo segundo, la operación pide token. entry-hub no tiene ningún `AllowAnonymous` dentro de un grupo protegido, pero la comprobación cuesta una condición y evita el día que alguien lo añada y el documento siga diciendo que hace falta token.

Así queda en el contrato `POST /api/v1/rooms`, con su requisito:

```json
"security": [
  {
    "Bearer": []
  }
]
```

`GET /api/v1/health` no lleva `security`, y las probes, que describimos a mano en el post anterior, tampoco.

La lista de `"Bearer": []` va vacía. En OAuth ahí irían los scopes, y OpenAPI 3.1 permite poner nombres de rol para otros esquemas. entry-hub la deja vacía y cuenta el rol en el resumen de la operación, donde lo lee una persona: el de crear una sala es "Creates a room. Facilities only.".

## Probar con token desde Scalar

En Scalar, el esquema declarado aparece en la parte de autenticación, y las operaciones con requisito llevan su candado. Le decimos qué esquema usar por defecto:

```csharp
app.MapScalarApiReference(options => options
    .WithTitle("EntryHub API")
    .AddPreferredSecuritySchemes(BearerScheme));
```

Con una sola opción parece de más, pero si algún día hay dos esquemas (un JWT y una API key, por ejemplo), Scalar arranca con el que nos interesa en vez de obligar a elegir.

El recorrido completo en local:

1. Arranca la API en Development y abre `/scalar/v1`.
2. En otra terminal, crea un token con el rol que quieras probar:

   ```bash
   cd src/EntryHub.Api
   dotnet user-jwts create --role Facilities --name fran
   ```

3. Copia el token que imprime y pégalo en el campo del token Bearer de Scalar.
4. Abre `POST /api/v1/rooms`, rellena el body y envía. Ahora la respuesta es un `201 Created` con la sala.

Si repites el paso 2 con `--role Employee`, la misma petición devuelve un `403 Forbidden`: el token es válido, pero ese rol no puede crear salas. Es una forma rápida de comprobar las políticas sin escribir un test.

## Proteger la documentación

El documento OpenAPI cuenta mucho de tu API: todas las rutas, los esquemas de cada request y respuesta, las reglas de validación y qué partes piden token. Para quien la consume es justo lo que necesita. Para quien busca por dónde atacarla, también. No es un secreto, pero tampoco algo que deba quedar público porque nadie se acordó de cerrarlo.

En entry-hub la regla depende del entorno:

```csharp
public static void MapEntryHubDocumentation(this WebApplication app)
{
    var json = app.MapOpenApi("/openapi/{documentName}.json");
    var yaml = app.MapOpenApi("/openapi/{documentName}.yaml");

    if (!app.Environment.IsDevelopment())
    {
        json.RequireAuthorization(Policies.Facilities);
        yaml.RequireAuthorization(Policies.Facilities);
        return;
    }

    app.MapScalarApiReference(options => options
        .WithTitle("EntryHub API")
        .AddPreferredSecuritySchemes(BearerScheme));
}
```

En Development, el documento está abierto y Scalar existe. En cualquier otro entorno, Scalar no se mapea y el JSON y el YAML piden un token con el rol `Facilities`. `MapOpenApi` devuelve un endpoint como cualquier otro, así que se protege con la misma política que el resto de la API.

Fíjate en que la condición es `!IsDevelopment()` y no `IsProduction()`. Un entorno nuevo, como `Staging` o el `Testing` de los tests, queda protegido sin tocar nada.

Si tu API es pública y quieres el documento abierto para todo el mundo, se quitan las dos llamadas a `RequireAuthorization`. Lo importante es que sea una línea que alguien borra a propósito y que se ve en un PR.

### La excepción deliberada

En el post anterior vimos que la release publica el contrato y una documentación estática con Scalar en GitHub Pages. Esa página es pública, y no es un descuido. El contrato publicado es el de una versión ya liberada, sin acceso a ningún entorno, y entry-hub es un proyecto de ejemplo que quiere que se lea. En una API interna de empresa, ese job de Pages es lo primero que quitaría o movería a un sitio con acceso restringido.

Las dos decisiones están escritas en el repositorio: el documento que sirve la API está cerrado fuera de Development, y el que publica la release está abierto porque así lo decide un workflow que cualquiera puede leer.

## Los tests que lo vigilan

Todo esto se rompe sin que nadie lo vea: alguien mueve una línea de `MapEntryHubDocumentation` y el documento queda abierto en producción. Por eso hay tests de integración en `Documentation/OpenApiEndpointTests.cs`. Los tests arrancan la API en el entorno `Testing`, así que comprueban el comportamiento de fuera de Development.

Sin token, el documento responde 401 en los dos formatos:

```csharp
[Theory]
[InlineData("/openapi/v1.json")]
[InlineData("/openapi/v1.yaml")]
public async Task Returns_401_to_anonymous_callers(string path)
{
    using var api = await TestApi.StartAsync();

    var response = await api.Anonymous().GetAsync(path, CancellationToken.None);

    Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
}
```

Con un token de `Employee` responde 403, con uno de `Facilities` devuelve el YAML, y `/scalar/v1` da 404. Los tokens de los tests no salen de `user-jwts`: los firma una clave que solo existe durante el test, inyectada en la misma sección de configuración que lee `AddJwtBearer`.

El último test comprueba el documento por dentro, con el esquema y los candados:

```csharp
[Fact]
public async Task Describes_the_bearer_scheme_and_locks_only_the_protected_operations()
{
    using var api = await TestApi.StartAsync();

    var json = await api.ClientFor("fran", Roles.Facilities).GetStringAsync("/openapi/v1.json", CancellationToken.None);

    using var document = JsonDocument.Parse(json);
    var root = document.RootElement;
    Assert.Equal("bearer", root.GetProperty("components").GetProperty("securitySchemes").GetProperty("Bearer").GetProperty("scheme").GetString());
    Assert.True(root.GetProperty("paths").GetProperty("/api/v1/rooms").GetProperty("post").TryGetProperty("security", out _));
    Assert.False(root.GetProperty("paths").GetProperty("/api/v1/health").GetProperty("get").TryGetProperty("security", out _));
}
```

Comprueba que una operación protegida lleva candado y una pública no. Si alguien mueve el requisito al documento entero, el segundo `Assert` falla.

## Resumiendo

- El generador no sabe que la API usa JWT: el esquema `Bearer` se declara con un transformer de documento.
- El candado va por operación, leyendo `IAuthorizeData` e `IAllowAnonymous` de los metadatos, para que lo público se vea público. Scalar lo aprovecha para probar con un token de `dotnet user-jwts`.
- Fuera de Development, Scalar no existe y el documento pide el rol `Facilities`. Abrirlo es una decisión que se ve en el código, igual que la página pública de la release.

El código está en [entry-hub](https://github.com/MookieFumi/entry-hub). En la siguiente píldora personalizamos el documento y Scalar con logo, contacto y colores.
