---
title: "Minimal APIs sin el Program.cs de 800 líneas"
subtitle: Lo que ofrece Minimal APIs en .NET 10 y cómo organizar el código para que crezca sin desordenarse
description: Minimal APIs en .NET 10 con MapGroup, TypedResults y Server-Sent Events, organizadas en vertical slices con un handler por caso de uso registrado por convención.
date: 2026-09-23
topic: aspnet
series: minimal-apis-dotnet
published: false
---

La primera vez que vi Minimal APIs fue en una demo con todo dentro de `Program.cs`: el `DbContext`, tres endpoints, la validación a mano y un `app.Run()` al final. Para una demo vale. En un proyecto real ese fichero llega a las ochocientas líneas y nadie quiere abrirlo. Durante un tiempo pensé que el problema era Minimal APIs. Me equivocaba: el problema era meterlo todo en un fichero.

En esta serie vamos a construir [entry-hub](https://github.com/MookieFumi/entry-hub), una API para reservar salas de reuniones en una oficina. Tiene salas, reservas, autenticación con JWT y PostgreSQL detrás. En este primer post vemos qué ofrece hoy Minimal APIs y, al final, cómo organizar el código para que el `Program.cs` se quede en unas pocas líneas:

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

builder.Services.AddDbContext<EntryHubDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("EntryHub")));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddValidation();
builder.Services.AddEntryHubSecurity();
builder.Services.AddEntryHubOpenApi();
builder.Services.AddFeatureHandlers();
builder.Services.AddV1Features(builder.Configuration);

var app = builder.Build();

app.UseAuthentication();
app.UseAuthorization();

app.MapDefaultEndpoints();
app.MapV1Endpoints();
app.MapEntryHubDocumentation();

app.Run();
```

He quitado algunas líneas que no vienen al caso. Ningún endpoint vive aquí.

## Minimal APIs en .NET 10, de un vistazo

Minimal APIs llegó con .NET 6 y entonces le faltaba bastante para competir con los controllers. En .NET 10 ya tiene casi todo lo que se usa a diario:

- Grupos de rutas con `MapGroup`, para compartir prefijo, etiquetas y autorización.
- Resultados tipados con `TypedResults` y `Results<...>`, que el compilador comprueba y que OpenAPI entiende sin atributos.
- Filtros de endpoint (`IEndpointFilter`), el equivalente de los filtros de acción.
- Validación integrada con `AddValidation()` y DataAnnotations. Se cuenta en el siguiente post.
- OpenAPI nativo con `Microsoft.AspNetCore.OpenApi`, que genera un documento 3.1. Va en el tercero.
- Server-Sent Events con `TypedResults.ServerSentEvents`, nuevo en .NET 10.

Un endpoint es un delegado. Sus parámetros salen de la ruta, la query, el cuerpo o el contenedor de dependencias, y el framework decide de dónde según el tipo. Este es el de obtener una sala en entry-hub:

```csharp
group.MapGet("/{id:guid}", HandleAsync).WithName("GetRoom").WithSummary("Gets a room by id.");

static async Task<Results<Ok<RoomResponse>, NotFound>> HandleAsync(
    Guid id,
    GetRoomHandler handler,
    CancellationToken cancellationToken)
{
    var room = await handler.HandleAsync(id, cancellationToken);

    return room is null ? TypedResults.NotFound() : TypedResults.Ok(room);
}
```

`id` viene de la ruta, `GetRoomHandler` del contenedor y `CancellationToken` es el de la petición, que se cancela si el cliente cierra la conexión. No hace falta `[FromServices]`: si el tipo está registrado en DI, se inyecta.

Para varios parámetros de query, un record con `[AsParameters]` evita una firma de seis argumentos:

```csharp
public sealed record ListRoomsQuery(int? Floor, int? MinCapacity, int? Page, int? PageSize);

static async Task<Ok<PagedResponse<RoomResponse>>> HandleAsync(
    [AsParameters] ListRoomsQuery query,
    ListRoomsHandler handler,
    CancellationToken cancellationToken) =>
    TypedResults.Ok(await handler.HandleAsync(query, cancellationToken));
```

## Agrupar rutas con `MapGroup`

`MapGroup` crea un prefijo de ruta al que puedes colgar metadatos: etiquetas para OpenAPI, políticas de autorización, filtros. Todo lo que cuelga de un grupo lo heredan sus endpoints y sus subgrupos.

En entry-hub la API está versionada desde el primer día, así que todo cuelga de `/api/v1`:

```csharp
public static IEndpointRouteBuilder MapV1Endpoints(this IEndpointRouteBuilder app)
{
    var v1 = app.MapGroup("/api/v1");

    GetHealthEndpoint.Map(v1);
    v1.MapRoomsEndpoints();
    v1.MapBookingsEndpoints();

    return app;
}
```

Por qué versionar por URL y no con `Asp.Versioning.Http` lo explico en una píldora aparte. Dentro de `/api/v1`, las salas tienen su propio grupo:

```csharp
var rooms = v1.MapGroup("/rooms").WithTags("Rooms").RequireAuthorization(Policies.AnyEmployee);
```

Con esa línea, todos los endpoints de salas salen bajo `/api/v1/rooms`, se agrupan en OpenAPI con la etiqueta `Rooms` y piden un usuario autenticado con algún rol de empleado. Un endpoint concreto puede endurecer la regla. Crear una sala, por ejemplo, solo lo puede hacer el equipo de instalaciones:

```csharp
group.MapPost("/", HandleAsync).WithName("CreateRoom").RequireAuthorization(Policies.Facilities);
```

Las políticas se acumulan: para crear una sala hay que cumplir la del grupo y la del endpoint.

## Respuestas tipadas con `TypedResults`

`Results.Ok(room)` devuelve un `IResult`. Funciona, pero no dice nada de lo que puede devolver el endpoint. `TypedResults.Ok(room)` devuelve un `Ok<RoomResponse>`, y si declaras en la firma todos los resultados posibles, el compilador comprueba que no devuelves otra cosa:

```csharp
static async Task<Results<Created<RoomResponse>, ProblemHttpResult>> HandleAsync(
    CreateRoomRequest request,
    CreateRoomHandler handler,
    CancellationToken cancellationToken)
{
    var room = await handler.HandleAsync(request, cancellationToken);

    return room is null
        ? TypedResults.Problem(
            title: "Room name already in use",
            detail: $"A room named '{request.Name.Trim()}' already exists.",
            statusCode: StatusCodes.Status409Conflict)
        : TypedResults.Created($"/api/v1/rooms/{room.Id}", room);
}
```

Si mañana alguien añade un `return TypedResults.NotFound();`, no compila hasta que lo añada también a `Results<...>`, así que la firma documenta el endpoint y no se queda desfasada.

Además, el generador de OpenAPI lee esos tipos y documenta las respuestas sin `[ProducesResponseType]` ni `.Produces<T>()`: el `201` con su esquema `RoomResponse` sale solo. El `409` no aparece, porque `ProblemHttpResult` no dice qué código de estado lleva. Lo veremos en el post de OpenAPI.

## Server-Sent Events: la ocupación de una sala en vivo

Una pantalla en la puerta de cada sala tiene que saber si está libre o no y hasta cuándo. Se puede hacer con polling, o con SignalR si necesitas comunicación en los dos sentidos. Para un flujo que va solo del servidor al cliente, .NET 10 trae Server-Sent Events: una respuesta HTTP que no se cierra y por la que el servidor va mandando eventos de texto.

El endpoint devuelve `TypedResults.ServerSentEvents` con un `IAsyncEnumerable`:

```csharp
group.MapGet("/{id:guid}/occupancy", HandleAsync).WithName("StreamRoomOccupancy");

static async Task<Results<ServerSentEventsResult<RoomOccupancy>, NotFound>> HandleAsync(
    Guid id,
    StreamRoomOccupancyHandler handler,
    CancellationToken cancellationToken)
{
    var stream = await handler.HandleAsync(id, cancellationToken);

    return stream is null
        ? TypedResults.NotFound()
        : TypedResults.ServerSentEvents(stream, eventType: "occupancy");
}
```

El handler comprueba primero que la sala existe, para poder devolver un `404` antes de empezar el stream. Después devuelve un iterador que calcula la ocupación cada pocos segundos con un `PeriodicTimer`:

```csharp
private async IAsyncEnumerable<RoomOccupancy> StreamAsync(
    Guid roomId,
    [EnumeratorCancellation] CancellationToken cancellationToken)
{
    using var timer = new PeriodicTimer(options.Value.Interval, clock);

    do
    {
        var now = clock.GetUtcNow();

        var busy = await db.Bookings.AsNoTracking()
            .Where(booking => booking.RoomId == roomId && booking.Status == BookingStatus.Confirmed && booking.EndAt > now)
            .Select(booking => new TimeRange(booking.StartAt, booking.EndAt))
            .ToListAsync(cancellationToken);

        yield return OccupancyCalculator.Calculate(roomId, busy, now);
    }
    while (await timer.WaitForNextTickAsync(cancellationToken));
}
```

Cuando el cliente se desconecta, el `CancellationToken` se cancela, `WaitForNextTickAsync` lanza `OperationCanceledException` y el bucle termina. No hay que limpiar nada a mano. El `TimeProvider` inyectado permite que los tests usen un intervalo de milisegundos y un reloj fijo.

Para verlo, `curl -N` desactiva el buffer y va pintando los eventos según llegan. El token sale de `dotnet user-jwts`, como cuenta el README del repo:

```bash
curl -N -H "Authorization: Bearer <token>" http://localhost:5178/api/v1/rooms/<id>/occupancy
```

```text
event: occupancy
data: {"roomId":"0199...","status":"Occupied","at":"2026-10-19T10:00:00+00:00","nextChange":"2026-10-19T10:30:00+00:00"}

event: occupancy
data: {"roomId":"0199...","status":"Occupied","at":"2026-10-19T10:00:05+00:00","nextChange":"2026-10-19T10:30:00+00:00"}
```

En el navegador basta un `EventSource`, que además reconecta solo si la conexión se corta.

## Minimal APIs frente a `ControllerBase`

La pregunta de siempre es si esto sustituye a los controllers. En la mayoría de APIs nuevas, sí. La comparación rápida:

| | Minimal APIs | Controllers |
| --- | --- | --- |
| Binding | Ruta, query, cuerpo, cabeceras y DI por tipo; `[AsParameters]` para agrupar | Igual, más model binders propios (`IModelBinder`) |
| Filtros | `IEndpointFilter`, por endpoint o grupo | Filtros de acción, de recurso, de resultado y de excepción |
| Validación | `AddValidation()` con DataAnnotations (.NET 10) | `[ApiController]` y `ModelState` |
| OpenAPI | Nativo, lee `TypedResults` | Nativo, con `[ProducesResponseType]` para cada código que no sea el principal |
| Native AOT | Soportado | No soportado |
| Convenciones | Las montas tú con grupos y métodos de extensión | Convenciones de enrutado y de modelo de aplicación |

Yo seguiría con controllers en tres casos:

- La API ya está hecha con controllers y funciona. Migrar por migrar no aporta nada.
- Dependes de algo que solo existe en MVC, como convenciones de modelo de aplicación (`IApplicationModelConvention`), model binders propios muy trabajados o librerías que se integran con el pipeline de MVC.
- El equipo conoce MVC a fondo y la API es pequeña. El coste de cambiar de modelo mental no compensa.

Para lo demás me quedo con Minimal APIs, entre otras cosas porque encaja mejor con la organización por casos de uso que viene ahora.

## Una carpeta por caso de uso

Hasta aquí todo es Minimal APIs. Falta decidir dónde vive cada cosa. La organización clásica por capas (`Controllers`, `Services`, `Repositories`, `Models`) reparte un caso de uso por cuatro carpetas: para tocar "crear una sala" abres cuatro ficheros en cuatro sitios distintos.

Con vertical slice se organiza al revés: una carpeta por caso de uso, con todo lo que necesita dentro. Las salas de entry-hub quedan así:

```text
Features/V1/Rooms/
├── CreateRoom/
│   ├── CreateRoomEndpoint.cs
│   ├── CreateRoomHandler.cs
│   └── CreateRoomRequest.cs
├── GetRoom/
│   ├── GetRoomEndpoint.cs
│   └── GetRoomHandler.cs
├── ListRooms/
│   ├── ListRoomsEndpoint.cs
│   ├── ListRoomsHandler.cs
│   └── ListRoomsQuery.cs
├── StreamRoomOccupancy/
│   ├── StreamRoomOccupancyEndpoint.cs
│   ├── StreamRoomOccupancyHandler.cs
│   └── StreamRoomOccupancyOptions.cs
├── RoomResponse.cs
└── RoomsEndpoints.cs
```

Cada carpeta tiene como mucho tres piezas:

- La request (o query): lo que entra. Un record con sus reglas de validación.
- El handler: lo que hace el caso de uso. Habla con la base de datos y no sabe nada de HTTP.
- El endpoint: la traducción entre HTTP y el handler. Ruta, metadatos y códigos de estado.

`RoomResponse` está fuera porque la comparten varios casos de uso. `RoomsEndpoints` es donde se juntan los slices de salas: crea el grupo `/rooms` y llama al `Map` de cada endpoint.

```csharp
public static void MapRoomsEndpoints(this RouteGroupBuilder v1)
{
    var rooms = v1.MapGroup("/rooms").WithTags("Rooms").RequireAuthorization(Policies.AnyEmployee);

    CreateRoomEndpoint.Map(rooms);
    GetRoomEndpoint.Map(rooms);
    ListRoomsEndpoint.Map(rooms);
    StreamRoomOccupancyEndpoint.Map(rooms);
}
```

`V1Endpoints`, que vimos antes, hace lo mismo un nivel más arriba con salas, reservas y salud. Si mañana llega una `v2`, tendrá su `Features/V2` y su `V2Endpoints`, y la `v1` no se toca.

## El endpoint solo delega en su handler

El endpoint de crear sala que vimos antes no tiene lógica: recibe la petición, llama al handler y traduce el resultado a HTTP. Lo que hace crear una sala está en el handler:

```csharp
public sealed class CreateRoomHandler(EntryHubDbContext db, TimeProvider clock)
{
    /// <returns>The new room, or <see langword="null"/> when another room already has that name.</returns>
    public async Task<RoomResponse?> HandleAsync(CreateRoomRequest request, CancellationToken cancellationToken)
    {
        var name = request.Name.Trim();

        if (await db.Rooms.AnyAsync(room => room.Name == name, cancellationToken))
        {
            return null;
        }

        var room = new Room
        {
            Id = Guid.CreateVersion7(),
            Name = name,
            Floor = request.Floor,
            Capacity = request.Capacity,
            Equipment = request.Equipment?.Select(item => item.Trim()).Where(item => item.Length > 0).Distinct().ToList() ?? [],
            CreatedAt = clock.GetUtcNow(),
        };

        db.Rooms.Add(room);

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // Two requests with the same name raced past the check above; the unique index decided.
            return null;
        }

        return RoomResponse.From(room);
    }
}
```

El handler devuelve `null` cuando el nombre ya existe, y es el endpoint el que decide que eso es un `409` con `ProblemDetails`. Así el handler se puede probar sin HTTP y el endpoint se queda en diez líneas.

Tres decisiones que tomé a propósito:

- **El handler es una clase concreta.** No hay `ICreateRoomHandler`. Cada handler tiene un único consumidor, su endpoint, y una interfaz con una sola implementación solo añade un fichero más que mantener. Los tests usan la clase real contra una base de datos real, así que tampoco hace falta para mockear.
- **El `DbContext` va dentro del handler.** Sin repositorio en medio. EF Core ya es un repositorio y una unidad de trabajo, y cada handler escribe exactamente la consulta que necesita.
- **Cada handler tiene su propia firma.** `HandleAsync(CreateRoomRequest, CancellationToken)` en uno y `HandleAsync(Guid, CancellationToken)` en otro. No hay una interfaz común que obligue a todos a recibir y devolver lo mismo. El endpoint llama a un método concreto y desde el IDE llegas a él con un clic.

## Registrar handlers sin acordarte de hacerlo

Con lo anterior hay un detalle que molesta. Cada handler tiene que estar registrado en el contenedor para que el endpoint lo reciba, y al principio entry-hub lo hacía a mano en cada feature:

```csharp
services.AddScoped<CreateRoomHandler>();
services.AddScoped<GetRoomHandler>();
services.AddScoped<ListRoomsHandler>();
services.AddScoped<StreamRoomOccupancyHandler>();
```

Nueve líneas para nueve handlers, y el día que olvidas una el proyecto compila, los tests del handler pasan porque lo crean con `new`, y el error aparece cuando alguien llama al endpoint y ASP.NET Core no sabe de dónde sacar el parámetro.

La solución es una convención: toda clase concreta bajo el namespace `Features` cuyo nombre termine en `Handler` es un handler y se registra sola.

```csharp
public static class HandlerRegistration
{
    private const string HandlerSuffix = "Handler";

    public static IServiceCollection AddFeatureHandlers(this IServiceCollection services)
    {
        foreach (var handler in FindHandlers())
        {
            services.AddScoped(handler);
        }

        return services;
    }

    public static IReadOnlyList<Type> FindHandlers()
    {
        var featuresNamespace = typeof(HandlerRegistration).Namespace + ".";

        return [.. typeof(HandlerRegistration).Assembly.GetTypes()
            .Where(type => type is { IsClass: true, IsAbstract: false, IsGenericTypeDefinition: false }
                && type.Name.EndsWith(HandlerSuffix, StringComparison.Ordinal)
                && type.Namespace?.StartsWith(featuresNamespace, StringComparison.Ordinal) == true)
            .OrderBy(type => type.FullName, StringComparer.Ordinal)];
    }
}
```

Se llama una vez en `Program.cs` con `builder.Services.AddFeatureHandlers()`. Lo que hace:

- Recorre los tipos del ensamblado de la API una sola vez, al arrancar.
- Se queda con las clases concretas que terminan en `Handler` y están dentro de `Features`. El filtro por namespace evita registrar por accidente una clase de fuera de `Features` que también termine en `Handler`, como un `AuthorizationHandler` propio.
- Las registra como `Scoped`, el mismo ciclo de vida que el `DbContext` que casi todas reciben.

Usa reflexión, pero solo al arrancar y sobre un ensamblado pequeño, así que no se nota. Si algún día publicas la API con Native AOT, la reflexión sobre tipos no es compatible con el recorte y tocaría generar este registro en compilación con un source generator. entry-hub no usa AOT, así que la versión simple basta.

La convención tiene un punto débil: si alguien llama a su clase `CreateRoomService`, no se registra. Por eso la acompaña un test que construye la aplicación de verdad y pide cada handler al contenedor:

```csharp
[Fact]
public void Every_handler_resolves_from_the_container()
{
    // Building the handler checks that its own dependencies are registered too. No query reaches the database.
    using var factory = new ApiFactory(TestDatabase.Unreachable);
    using var scope = factory.Services.CreateScope();

    Assert.All(HandlerRegistration.FindHandlers(), handler => Assert.NotNull(scope.ServiceProvider.GetService(handler)));
}
```

Al resolver el handler, el contenedor también construye sus dependencias, así que el test falla si un handler pide algo que nadie registró, como unas opciones o una política. No necesita base de datos: crear el `DbContext` no abre ninguna conexión.

El endpoint sigue declarando en su firma el handler que usa, así que desde el IDE vas de uno a otro sin pasar por ningún registro.

## Probar un slice en tres capas

La separación entre endpoint, handler y lógica pura tiene otra ventaja: cada pieza se prueba en la capa que le corresponde. entry-hub tiene tres.

**Capa 1: lógica pura.** `OccupancyCalculator` decide si una sala está ocupada a partir de una lista de franjas y un instante. No tiene dependencias, así que el test no necesita base de datos ni reloj:

```csharp
[Fact]
public void Room_is_occupied_until_the_end_of_the_current_booking()
{
    var busy = new[] { new TimeRange(Now.AddMinutes(-30), Now.AddMinutes(30)) };

    var occupancy = OccupancyCalculator.Calculate(RoomId, busy, Now);

    Assert.Equal(RoomStatus.Occupied, occupancy.Status);
    Assert.Equal(Now.AddMinutes(30), occupancy.NextChange);
}
```

Aquí van los casos raros: reservas encadenadas, la siguiente reserva del día, una sala sin reservas. Son tests de milisegundos y puede haber muchos.

**Capa 2: handler contra PostgreSQL real.** El handler se crea con `new`, con un `DbContext` real y un reloj fijo. Sin HTTP:

```csharp
[Fact]
public async Task Create_stores_the_room_with_the_clock_time_and_clean_equipment()
{
    await TestDatabase.EnsureMigratedAsync();
    await using var db = TestDatabase.CreateContext();
    var now = new DateTimeOffset(2026, 10, 19, 9, 0, 0, TimeSpan.Zero);
    var handler = new CreateRoomHandler(db, new FixedClock(now));
    var name = UniqueName();

    var created = await handler.HandleAsync(
        new CreateRoomRequest($"  {name}  ", 3, 8, [" Projector ", "", "Projector", "Whiteboard"]),
        CancellationToken.None);

    Assert.NotNull(created);
    Assert.Equal(name, created.Name);
    Assert.Equal(now, created.CreatedAt);
    Assert.Equal(["Projector", "Whiteboard"], created.Equipment);
}
```

Uso PostgreSQL y no el proveedor en memoria de EF Core porque el índice único, las restricciones y el SQL que se genera son los de producción. Cada test usa nombres únicos, así que pueden ir en paralelo sobre la misma base de datos.

**Capa 3: el endpoint con `WebApplicationFactory`.** La aplicación entera en memoria, con rutas, autorización, validación y serialización. Aquí solo compruebo lo que añade HTTP: que la ruta cuelga de `/api/v1`, que los roles se aplican y que los códigos de estado son los correctos.

```csharp
[Fact]
public async Task An_employee_can_read_rooms_but_not_create_them()
{
    using var api = await TestApi.StartAsync();
    using var employee = api.ClientFor("ana", Roles.Employee);

    Assert.Equal(HttpStatusCode.OK, (await employee.GetAsync("/api/v1/rooms")).StatusCode);

    var create = await employee.PostAsJsonAsync("/api/v1/rooms", new CreateRoomRequest(UniqueName(), 2, 6, null));
    Assert.Equal(HttpStatusCode.Forbidden, create.StatusCode);
}
```

La lógica de negocio no se vuelve a probar en esta capa. Si un test de endpoint falla, el problema está en el cableado HTTP, no en el cálculo.

## Lo que el vertical slice no te resuelve

Vertical slice no es gratis, y conviene saber dónde aprieta.

**El código compartido necesita un sitio.** La paginación, el usuario que hace la petición o una respuesta común no pertenecen a ningún caso de uso. En entry-hub viven en `Features/V1/Common` (`Paging`, `PagedResponse`, `Caller`), y la lógica de dominio que usan varios slices, como `OccupancyCalculator` o las reglas de reserva, está en `Domain`. Cuidado con que `Common` acabe siendo el cajón de sastre de siempre: si algo solo lo usa un slice, va en su carpeta.

**Hay algo de duplicación, y se acepta.** Dos handlers pueden hacer consultas parecidas a la misma tabla. Antes de extraer un método común, pregúntate si los dos casos de uso cambiarán siempre juntos. Si no, la duplicación es más barata que el acoplamiento.

**No compensa en un CRUD trivial.** Si la API es una tabla con cuatro operaciones y sin reglas, tres ficheros por operación es demasiada ceremonia. Ahí un fichero con los cuatro endpoints, que hablan directamente con el `DbContext`, se lee mejor.

## Resumiendo

- Minimal APIs en .NET 10 ya trae grupos de rutas, resultados tipados, validación, OpenAPI y Server-Sent Events. Para una API nueva no hace falta MVC.
- Lo que la hace crecer bien es la organización: una carpeta por caso de uso, con un endpoint que solo traduce HTTP y un handler concreto que hace el trabajo.
- Una convención registra los handlers sola y un test se asegura de que ninguno se queda fuera.

El código de este post está en [entry-hub](https://github.com/MookieFumi/entry-hub). En el siguiente vemos qué entra en la API: la validación integrada con `AddValidation`, las reglas de negocio en el handler y cómo devolver los errores con `ProblemDetails`.
