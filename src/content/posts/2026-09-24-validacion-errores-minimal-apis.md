---
title: "Enséñale a tu API a decir que no"
subtitle: Validación integrada de .NET 10, reglas de negocio en el handler y errores con ProblemDetails, o cuándo responder 400, 422 o 409
description: Cómo validar la entrada de una Minimal API en .NET 10 en dos niveles, con AddValidation para la forma del request y reglas de negocio en el handler, y cómo devolver 400, 422 y 409 con ProblemDetails.
date: 2026-09-24
topic: aspnet
series: minimal-apis-dotnet
published: false
---

Tres peticiones para reservar una sala en [entry-hub](https://github.com/MookieFumi/entry-hub), y las tres fallan. La primera llega sin título y con cero asistentes. La segunda pide la sala un sábado para nueve personas, y la sala es de cuatro. La tercera es correcta, pero otra persona acaba de reservar esa misma franja.

Las tres son "errores de validación", y sería fácil responder un 400 a todas. Pero no las detecta el mismo código y el cliente no tiene que hacer lo mismo con cada una: la primera es un formulario mal rellenado, la segunda una regla del negocio y la tercera una carrera que el usuario ha perdido. En el [post anterior](/2026-09-23-minimal-apis-vertical-slice) organizamos la API en una carpeta por caso de uso. En este vemos dónde se valida cada cosa y cómo se lo contamos al cliente.

## Dos niveles de validación

La pregunta que separa los dos niveles es qué necesitas para comprobar la regla.

| Qué se comprueba | Necesita | Dónde | Respuesta |
| --- | --- | --- | --- |
| Campos obligatorios, longitudes, rangos, `EndAt` después de `StartAt` | Solo el request | En el borde, con `AddValidation()` | `400 Bad Request` |
| Duración, horario de oficina, antelación, capacidad de la sala, límite de reservas | Configuración, la hora actual o la base de datos | En el handler | `422 Unprocessable Entity` |
| Que nadie más tenga la sala a esa hora | La base de datos en el momento de guardar | Una restricción de PostgreSQL | `409 Conflict` |

Si la regla se comprueba mirando solo el JSON, va en el primer nivel. Si necesita saber qué hora es, cómo es la sala o qué hay en la base de datos, va en el handler.

## `AddValidation()`: la validación integrada de .NET 10

Hasta .NET 9, Minimal APIs no validaba nada por su cuenta. Había que llamar a `Validator.TryValidateObject` a mano, escribir un filtro de endpoint o añadir una librería. En .NET 10 basta una línea en `Program.cs`:

```csharp
builder.Services.AddValidation();
```

A partir de ahí, los parámetros de los endpoints (el body, la query, las cabeceras) se validan con DataAnnotations antes de llegar al delegado. El request de crear una reserva es un record con sus atributos:

```csharp
/// <summary>
/// The shape of the body. Rules that need data or a clock are checked later, in the handler.
/// </summary>
public sealed record CreateBookingRequest(
    Guid RoomId,
    [property: Required, StringLength(120)] string Title,
    DateTimeOffset StartAt,
    DateTimeOffset EndAt,
    [property: Range(1, 500)] int Attendees) : IValidatableObject
{
    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (EndAt <= StartAt)
        {
            yield return new ValidationResult("EndAt must be after StartAt.", [nameof(EndAt)]);
        }
    }
}
```

Dos detalles:

- En un record posicional, un atributo a secas se queda en el parámetro del constructor. Con `[property: Required]` va a la propiedad que genera el record, donde lo ve cualquier herramienta que inspeccione propiedades y no solo la validación integrada.
- `IValidatableObject` cubre las reglas entre campos que no necesitan nada externo. Que el fin sea posterior al inicio se sabe mirando el request, así que va aquí y no en el handler.

Si el body no cumple, el endpoint no llega a ejecutarse. Esto es lo que responde entry-hub a la primera petición:

```json
{
  "title": "One or more validation errors occurred.",
  "errors": {
    "Title": ["The Title field is required."],
    "Attendees": ["The field Attendees must be between 1 and 500."]
  }
}
```

Un 400 con un diccionario `errors` por campo, que un frontend puede pintar al lado de cada input. Y el handler nunca recibe un request mal formado: no tiene que comprobar si `Title` es nulo.

Si algún endpoint no debe validarse (un webhook que acepta lo que le manden y lo guarda tal cual, por ejemplo), `.DisableValidation()` lo excluye. entry-hub no lo necesita.

## Reglas de negocio en el handler

La segunda petición tiene buena forma: título, fechas en orden, nueve asistentes. Lo que falla es que es sábado y la sala es de cuatro. Para saberlo hace falta la configuración del horario, la hora actual y la capacidad de la sala, y nada de eso está en el request.

Las reglas que solo necesitan configuración y la hora viven en `BookingPolicy`, en la carpeta `Domain`:

```csharp
public IReadOnlyList<RuleViolation> EvaluateNewBooking(
    DateTimeOffset start,
    DateTimeOffset end,
    int attendees,
    int roomCapacity,
    DateTimeOffset now)
{
    var violations = new List<RuleViolation>();
    var duration = end - start;

    if (duration < _rules.MinDuration)
    {
        violations.Add(new(BookingRuleCodes.DurationTooShort, $"A booking lasts at least {_rules.MinDuration.TotalMinutes:0} minutes."));
    }

    // ... maximum duration, quarter-hour slots, office hours, lead time and how far ahead

    if (attendees > roomCapacity)
    {
        violations.Add(new(BookingRuleCodes.ExceedsCapacity, $"The room holds {roomCapacity} people and {attendees} were announced."));
    }

    return violations;
}
```

La hora llega como argumento (`now`) en lugar de leerse dentro. Así los tests eligen el instante y no dependen del día en que se ejecutan. Los límites (duración mínima y máxima, franjas de 15 minutos, horario de 8:00 a 20:00 en `Europe/Madrid`, antelación) están en `BookingRulesOptions` con valores por defecto y se pueden cambiar desde la sección `BookingRules` de la configuración.

Las reglas que necesitan la base de datos se comprueban en el handler, que también llama a la política:

```csharp
var room = await db.Rooms.AsNoTracking()
    .SingleOrDefaultAsync(room => room.Id == request.RoomId && room.IsActive, cancellationToken);

if (room is null)
{
    return new CreateBookingResult.RulesBroken(
        [new(BookingRuleCodes.RoomUnavailable, "The room does not exist or is not available.")]);
}

var now = clock.GetUtcNow();
var violations = policy.EvaluateNewBooking(request.StartAt, request.EndAt, request.Attendees, room.Capacity, now).ToList();

if (!caller.IsFacilities)
{
    var active = await db.Bookings.CountAsync(
        booking => booking.OrganizerId == caller.Id
            && booking.Status == BookingStatus.Confirmed
            && booking.EndAt > now,
        cancellationToken);

    if (active >= policy.MaxActiveBookingsPerEmployee)
    {
        violations.Add(new(
            BookingRuleCodes.TooManyActiveBookings,
            $"You already have {active} active bookings; the limit is {policy.MaxActiveBookingsPerEmployee}."));
    }
}

if (violations.Count > 0)
{
    return new CreateBookingResult.RulesBroken(violations);
}
```

El handler no se para en la primera regla que falla. Acumula todas las violaciones y las devuelve juntas, porque al usuario le sirve más saber de una vez que el día y el número de personas están mal que corregir uno, reenviar y descubrir el otro.

## Resultados tipados en vez de excepciones

El handler podría lanzar una `BookingRulesException` y dejar que alguien la capture más arriba. En entry-hub devuelve un resultado de una jerarquía cerrada:

```csharp
/// <summary>
/// What can happen when a booking is requested. A closed set of cases instead of exceptions.
/// </summary>
public abstract record CreateBookingResult
{
    private CreateBookingResult()
    {
    }

    public sealed record Created(BookingResponse Booking) : CreateBookingResult;

    public sealed record RulesBroken(IReadOnlyList<RuleViolation> Violations) : CreateBookingResult;

    public sealed record Overlaps : CreateBookingResult;
}
```

El constructor privado impide crear casos fuera del record, así que los tres que hay son todos los posibles. El endpoint los traduce a HTTP con un `switch`:

```csharp
private static async Task<Results<Created<BookingResponse>, ProblemHttpResult>> HandleAsync(
    CreateBookingRequest request,
    ClaimsPrincipal user,
    CreateBookingHandler handler,
    CancellationToken cancellationToken)
{
    var result = await handler.HandleAsync(Caller.From(user), request, cancellationToken);

    return result switch
    {
        CreateBookingResult.Created created =>
            TypedResults.Created($"/api/v1/bookings/{created.Booking.Id}", created.Booking),
        CreateBookingResult.RulesBroken broken => BookingProblems.RulesBroken(broken.Violations),
        CreateBookingResult.Overlaps => BookingProblems.Overlaps(),
        _ => throw new InvalidOperationException($"Unhandled result {result.GetType().Name}."),
    };
}
```

Por qué así y no con excepciones:

- Que una reserva rompa una regla es lo esperado, no algo excepcional. Pasa a diario.
- La firma del handler dice lo que puede pasar. Con una excepción tienes que leer el código, o la documentación, para saber qué puede salir de ahí.
- Los tests comprueban el tipo del resultado (`Assert.IsType<CreateBookingResult.RulesBroken>`) sin `try` ni `Assert.Throws`.

La rama `_` del `switch` está ahí porque el compilador de C# no sabe que la jerarquía es cerrada. Si algún día se añade un caso nuevo y nadie lo traduce, el endpoint falla en el primer test en lugar de devolver algo raro.

## El solape lo decide PostgreSQL

Queda la tercera petición: la franja estaba libre cuando el usuario abrió el formulario, pero otra persona la ha reservado antes. La tentación es comprobarlo en el handler con un `AnyAsync` que busque reservas solapadas. Funciona en las pruebas manuales y falla en producción: si dos peticiones llegan a la vez, las dos hacen la consulta, las dos ven la sala libre y las dos guardan.

En entry-hub esa regla la aplica la base de datos, con una restricción de exclusión. EF Core no sabe modelarla, así que va en SQL dentro de la migración:

```csharp
// EF Core cannot model exclusion constraints, so this one is plain SQL. Two confirmed bookings of the
// same room cannot have overlapping ranges. The range is half-open ('[)'), so 10:00-11:00 and
// 11:00-12:00 do not overlap, and cancelled bookings no longer take part.
migrationBuilder.Sql("""
    ALTER TABLE bookings
        ADD CONSTRAINT ex_bookings_room_no_overlap
        EXCLUDE USING gist ("RoomId" WITH =, tstzrange("StartAt", "EndAt") WITH &&)
        WHERE ("Status" = 'Confirmed');
    """);
```

Se lee así: no puede haber dos filas confirmadas con el mismo `RoomId` (`=`) cuyos rangos de tiempo se solapen (`&&`). Combinar igualdad y solape en un índice GiST necesita la extensión `btree_gist`, que el `DbContext` declara con `HasPostgresExtension("btree_gist")`.

El handler no comprueba el solape. Intenta guardar y, si PostgreSQL dice que no, devuelve `Overlaps`:

```csharp
try
{
    await db.SaveChangesAsync(cancellationToken);
}
catch (Exception exception) when (LostToAnotherBooking(exception))
{
    // No overlap check in C#: the exclusion constraint of the database is the only judge, so two
    // simultaneous requests cannot both win.
    return new CreateBookingResult.Overlaps();
}
```

Con varias inserciones compitiendo por la misma franja, PostgreSQL no siempre responde con la violación de la restricción. A veces detecta un deadlock entre las comprobaciones del índice y elige a una de las transacciones como víctima, y EF Core envuelve ese error en una `InvalidOperationException` porque Npgsql lo marca como transitorio. Las dos cosas significan lo mismo, que otra reserva se ha quedado la franja, así que `LostToAnotherBooking` recorre las excepciones internas buscando cualquiera de los dos códigos:

```csharp
private static bool LostToAnotherBooking(Exception exception)
{
    for (var current = exception; current is not null; current = current.InnerException)
    {
        if (current is PostgresException { SqlState: PostgresErrorCodes.ExclusionViolation or PostgresErrorCodes.DeadlockDetected })
        {
            return true;
        }
    }

    return false;
}
```

Por la misma razón, los reintentos automáticos de Npgsql están desactivados en `Program.cs`. Un reintento silencioso volvería a intentar una reserva que ya ha perdido y escondería lo que ha pasado.

## `ProblemDetails` para todos los errores

Los tres errores salen en formato `ProblemDetails` ([RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)), que es lo que ASP.NET Core usa por defecto. Los dos de reservas están juntos en `BookingProblems`, porque los comparten crear y cancelar:

```csharp
internal static class BookingProblems
{
    public static ProblemHttpResult RulesBroken(IReadOnlyList<RuleViolation> violations) =>
        TypedResults.Problem(
            title: "The booking breaks the rules",
            detail: string.Join(" ", violations.Select(violation => violation.Message)),
            statusCode: StatusCodes.Status422UnprocessableEntity,
            extensions: new Dictionary<string, object?> { ["violations"] = violations });

    public static ProblemHttpResult Overlaps() =>
        TypedResults.Problem(
            title: "Room already booked",
            detail: "Another confirmed booking of this room overlaps the requested time.",
            statusCode: StatusCodes.Status409Conflict);
}
```

La reserva del sábado para nueve personas devuelve esto:

```json
{
  "type": "https://tools.ietf.org/html/rfc4918#section-11.2",
  "title": "The booking breaks the rules",
  "status": 422,
  "detail": "Rooms can be booked Monday to Friday between 08:00 and 20:00 (Europe/Madrid), within a single day. The room holds 4 people and 9 were announced.",
  "violations": [
    {
      "code": "OutsideOfficeHours",
      "message": "Rooms can be booked Monday to Friday between 08:00 and 20:00 (Europe/Madrid), within a single day."
    },
    {
      "code": "ExceedsCapacity",
      "message": "The room holds 4 people and 9 were announced."
    }
  ]
}
```

Y la reserva que llega tarde:

```json
{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.10",
  "title": "Room already booked",
  "status": 409,
  "detail": "Another confirmed booking of this room overlaps the requested time."
}
```

La extensión `violations` lleva un `code` estable por cada regla (`OutsideOfficeHours`, `ExceedsCapacity`, `TooManyActiveBookings`...). El cliente decide qué hacer según el código, no según el texto del mensaje, así que puedo cambiar la redacción o traducirla sin romper ningún frontend.

Si comparas con el 400 de antes, verás que le faltan `type` y `status`, y que llega como `application/json` y no como `application/problem+json`. Es porque entry-hub no registra `AddProblemDetails()`, y sin ese servicio la validación integrada escribe el JSON a pelo. Lo he probado: con esa línea en `Program.cs`, el mismo 400 llega como `application/problem+json` con `type`, `status` y `traceId`. Lo arreglamos en la píldora sobre el manejo global de errores, al final de esta serie.

## Probar cada nivel

Cada nivel tiene sus tests, en la capa que le toca.

Las reglas de `BookingPolicy` son lógica pura, con el reloj como argumento:

```csharp
[Fact]
public void Shorter_than_the_minimum_is_rejected() =>
    Assert.Contains(BookingRuleCodes.DurationTooShort, Codes(TuesdayNoon, TuesdayNoon.AddMinutes(10)));
```

Los tests del endpoint comprueban lo que añade HTTP: el 400 con los campos que fallan, el 422 con los códigos de regla y el 409 cuando dos usuarios piden la misma franja.

```csharp
[Fact]
public async Task Post_with_a_malformed_body_returns_400_with_the_failing_fields()
{
    using var api = await TestApi.StartAsync();
    var room = await NewRoomAsync(api);
    using var client = api.ClientFor(UniqueUser("ana"), Roles.Employee);

    var response = await client.PostAsJsonAsync(
        "/api/v1/bookings",
        new CreateBookingRequest(room.Id, "", Tuesday, Tuesday.AddHours(1), 0));

    Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    Assert.Equal(["Title", "Attendees"], await ErrorFieldsAsync(response));
}
```

El último es el que vigila el caso del deadlock: ocho reservas a la vez de la misma franja contra PostgreSQL real, de las que solo una puede ganar.

```csharp
[Fact]
public async Task Simultaneous_requests_for_one_slot_have_exactly_one_winner()
{
    var room = await NewRoomAsync();

    var results = await Task.WhenAll(Enumerable.Range(0, 8)
        .Select(_ => BookAsync(NewEmployee(), room.Id, Tuesday)));

    Assert.Single(results.OfType<CreateBookingResult.Created>());
    Assert.Equal(7, results.OfType<CreateBookingResult.Overlaps>().Count());
}
```

## ¿Y FluentValidation?

Es la librería de validación más usada en .NET y aporta cosas que DataAnnotations no tiene: reglas condicionales legibles, validación de colecciones elemento a elemento o mensajes localizados sin tocar atributos. A cambio, es una dependencia de terceros y no se integra sola con Minimal APIs, así que hay que llamar al validador desde el handler o desde un filtro de endpoint propio. Para lo que necesita entry-hub, `AddValidation()` y `IValidatableObject` bastan, y las reglas de verdad, las que necesitan datos, irían en el handler igualmente.

## Resumiendo

- La forma del request se valida en el borde con `AddValidation()` y DataAnnotations, y responde 400 con los campos que fallan.
- Las reglas que necesitan datos o la hora van en el handler, que devuelve un resultado tipado con todas las violaciones, y el endpoint lo convierte en un 422.
- Las reglas que dependen de la concurrencia las decide la base de datos. Una restricción de exclusión y un 409 hacen que dos peticiones simultáneas no puedan ganar las dos.

El código está en [entry-hub](https://github.com/MookieFumi/entry-hub). En el siguiente post vemos cómo queda todo esto en el documento OpenAPI y cómo se ve con Scalar.
