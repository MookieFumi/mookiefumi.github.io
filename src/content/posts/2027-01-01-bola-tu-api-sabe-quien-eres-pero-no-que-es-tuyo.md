---
title: "Tu API sabe quién eres, pero no qué es tuyo: BOLA, el riesgo número uno de OWASP"
subtitle: Cambiar un número en la URL sigue siendo la forma más barata de leer los datos de otro
description: "Qué es BOLA (Broken Object Level Authorization, OWASP API1:2023), por qué RequireAuthorization no lo evita en ASP.NET Core y dos formas de corregirlo: filtrar por propietario en EF Core o autorizar el recurso con IAuthorizationService."
date: 2027-01-01
topic: aspnet
series: owasp-api
published: false
---

En mayo de 2019, un promotor inmobiliario de Washington descubrió que podía leer las escrituras de otras personas en la web de First American Financial. Tenía el enlace a un documento de su propia operación y le bastó con cambiar un dígito del número que aparecía en la URL. [Según KrebsOnSecurity](https://krebsonsecurity.com/2019/05/first-american-financial-corp-leaked-hundreds-of-millions-of-title-insurance-records/), que lo confirmó, la web exponía unos 885 millones de ficheros, de 2003 en adelante, con números de cuenta, extractos bancarios y números de la seguridad social. Los números de documento parecían secuenciales.

Para explotarlo bastaba un navegador. En las APIs ese fallo se llama BOLA y encabeza la lista de riesgos de OWASP.

## Qué es BOLA

El [OWASP API Security Top 10](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/) de 2023 pone en primer lugar la *Broken Object Level Authorization*, BOLA. La regla que propone es corta:

> Every API endpoint that receives an ID of an object, and performs any action on the object, should implement object-level authorization checks.

Que alguien pueda llamar a un endpoint no le da derecho sobre cualquier objeto que pida por él: la comprobación tiene que hacerse con el objeto concreto. OWASP lo califica de fácil de explotar y de muy extendido. También explica por qué abunda en las APIs: el servidor no guarda el estado del cliente y decide qué objeto tocar con los ids que el propio cliente le manda.

Puede que lo conozcas como IDOR (*Insecure Direct Object Reference*), que es el nombre que OWASP usaba para aplicaciones web hasta 2017. [MITRE recoge los dos nombres](https://cwe.mitre.org/data/definitions/639.html) para la misma debilidad, la CWE-639.

El mismo documento lo separa de otro riesgo con el que se suele confundir. Si el usuario llega a un endpoint al que no debería poder llamar, por ejemplo uno de administración, es *Broken Function Level Authorization* (API5). En BOLA el usuario sí puede llamar al endpoint, y el fallo está en el objeto que pide.

## El endpoint vulnerable

En [entry-hub](https://github.com/MookieFumi/entry-hub), la API de reservas de salas de esta serie, cualquier empleado puede consultar una reserva por su id. El grupo de rutas exige estar autenticado y tener un rol de empleado:

```csharp
var bookings = v1.MapGroup("/bookings").WithTags("Bookings").RequireAuthorization(Policies.AnyEmployee);
```

Con eso, la primera versión del handler que se le ocurre a cualquiera es esta:

```csharp
public async Task<GetBookingResult> HandleAsync(ClaimsPrincipal user, Guid id, CancellationToken cancellationToken)
{
    var booking = await db.Bookings.AsNoTracking().SingleOrDefaultAsync(booking => booking.Id == id, cancellationToken);

    return booking is null
        ? new GetBookingResult.NotFound()
        : new GetBookingResult.Found(BookingResponse.From(booking));
}
```

Ana reserva una sala y Bea, otra empleada, pide `GET /api/v1/bookings/{id}` con el id de la reserva de Ana. La política `AnyEmployee` se cumple porque Bea es empleada, el handler encuentra la reserva y la devuelve con un `200`. Si en lugar de leerla Bea llama a `POST /bookings/{id}/cancel`, la cancela y recibe un `204`. Lo he comprobado quitando la comprobación de entry-hub y ejecutando los tests.

`RequireAuthorization` no puede evitarlo porque llega demasiado pronto. La [documentación de ASP.NET Core](https://learn.microsoft.com/aspnet/core/security/authorization/resource-based) lo explica para `[Authorize]`: el atributo se evalúa antes del binding y antes de que se cargue el recurso, así que no basta para autorizar recursos concretos. Con `RequireAuthorization` en Minimal APIs pasa lo mismo: la política se evalúa antes de que el handler cargue la reserva, cuando la API aún no sabe qué reserva vas a pedir.

## Arreglo 1: que la consulta solo encuentre lo tuyo

La forma más directa es que el propietario forme parte de la consulta. Es la primera opción que da la [guía de OWASP para prevenir IDOR](https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html): buscar solo entre los objetos a los que el usuario tiene acceso.

entry-hub ya lo hace en el listado de "mis reservas", que nunca recibe un id ajeno porque filtra por el `sub` del token:

```csharp
var bookings = db.Bookings.AsNoTracking().Where(booking => booking.OrganizerId == caller.Id);
```

Para la consulta por id quedaría así, con la regla de que el equipo de Facilities puede ver todas:

```csharp
var caller = Caller.From(user);

var booking = await db.Bookings
    .AsNoTracking()
    .SingleOrDefaultAsync(
        booking => booking.Id == id && (booking.OrganizerId == caller.Id || caller.IsFacilities),
        cancellationToken);

return booking is null
    ? new GetBookingResult.NotFound()
    : new GetBookingResult.Found(BookingResponse.From(booking));
```

Con esta versión, Bea recibe un `404`: la reserva existe, pero su consulta no la encuentra.

Tiene dos ventajas: es una sola consulta y es imposible devolver un objeto ajeno por un despiste posterior, porque nunca llega a cargarse. Como contrapartida, la API ya no distingue entre "no existe" y "no es tuya", y la regla de acceso queda mezclada con la consulta. Con una regla de una línea funciona bien. Cuando la regla crece o se repite en varios endpoints, conviene sacarla de ahí.

## Arreglo 2: cargar y preguntar con IAuthorizationService

ASP.NET Core trae de serie la otra opción, la [autorización basada en recursos](https://learn.microsoft.com/aspnet/core/security/authorization/resource-based). Se carga el objeto y se le pregunta a `IAuthorizationService` si el usuario puede hacer esa operación con él.

En entry-hub, la comprobación del organizador estaba copiada en dos handlers, el de consultar y el de cancelar. Ahora vive en un solo sitio. Primero, las operaciones que se pueden hacer con una reserva, con el `OperationAuthorizationRequirement` del framework:

```csharp
public static class BookingOperations
{
    public static readonly OperationAuthorizationRequirement Read = new() { Name = nameof(Read) };

    public static readonly OperationAuthorizationRequirement Cancel = new() { Name = nameof(Cancel) };
}
```

Después, el handler que decide. Recibe la reserva ya cargada:

```csharp
public sealed class BookingAuthorizationHandler : AuthorizationHandler<OperationAuthorizationRequirement, Booking>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        OperationAuthorizationRequirement requirement,
        Booking resource)
    {
        if (requirement.Name != BookingOperations.Read.Name && requirement.Name != BookingOperations.Cancel.Name)
        {
            return Task.CompletedTask;
        }

        var isOrganizer = context.User.FindFirstValue("sub") == resource.OrganizerId;

        if (isOrganizer || context.User.IsInRole(Roles.Facilities))
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }
}
```

Si llega una operación que el handler no conoce, no llama a `Succeed` y la respuesta es "no". Cuando alguien añada una operación nueva, no tendrá acceso hasta que se decida quién puede hacerla.

Se registra junto a las políticas:

```csharp
services.AddSingleton<IAuthorizationHandler, BookingAuthorizationHandler>();
```

Y el handler de la consulta carga la reserva y pregunta:

```csharp
public sealed class GetBookingHandler(EntryHubDbContext db, IAuthorizationService authorization)
{
    public async Task<GetBookingResult> HandleAsync(ClaimsPrincipal user, Guid id, CancellationToken cancellationToken)
    {
        var booking = await db.Bookings.AsNoTracking().SingleOrDefaultAsync(booking => booking.Id == id, cancellationToken);

        if (booking is null)
        {
            return new GetBookingResult.NotFound();
        }

        var result = await authorization.AuthorizeAsync(user, booking, BookingOperations.Read);

        return result.Succeeded
            ? new GetBookingResult.Found(BookingResponse.From(booking))
            : new GetBookingResult.Forbidden();
    }
}
```

El endpoint traduce `Forbidden` a `TypedResults.Forbid()`, que devuelve un `403`. La cancelación hace lo mismo con `BookingOperations.Cancel`. Si mañana Facilities puede leer cualquier reserva pero solo cancelar las de su planta, el cambio va en un único fichero.

El punto débil es el mismo que causa BOLA: hay que acordarse de llamar a `AuthorizeAsync` en cada endpoint que recibe un id. Nada en el framework te avisa si se te olvida en el siguiente.

## Cuál elegir

| | Consulta acotada | `IAuthorizationService` |
| --- | --- | --- |
| Dónde vive la regla | En cada consulta | En un handler por tipo de recurso |
| Ajeno o inexistente | Las dos dan `404` | Se pueden distinguir (`403` o `404`) |
| Reglas con varios casos | Se complican | Encajan |
| Si te olvidas | Devuelves datos ajenos | Devuelves datos ajenos |

Las dos se combinan bien. En entry-hub, el listado usa la consulta acotada porque lo natural es "mis reservas", y la consulta y la cancelación por id usan `IAuthorizationService` porque la regla tiene dos casos y se comparte.

## Resumiendo

- BOLA es el primer riesgo del OWASP API Security Top 10: un endpoint recibe el id de un objeto y no comprueba que quien llama pueda usar ese objeto.
- `RequireAuthorization` y `[Authorize]` se evalúan antes de cargar el recurso. Te dicen quién eres, pero no qué es tuyo.
- Hay dos arreglos: filtrar la consulta por el propietario o cargar el objeto y preguntar a `IAuthorizationService`. El segundo deja la regla en un solo sitio.
- Ninguno de los dos te protege del endpoint en el que te olvides de aplicarlo.

El código está en [entry-hub](https://github.com/MookieFumi/entry-hub). En el siguiente post veremos qué no te protege aunque lo parezca, como usar GUID en lugar de enteros, si conviene devolver `403` o `404` y el test que falla cuando un endpoint nuevo se olvida de la comprobación.
