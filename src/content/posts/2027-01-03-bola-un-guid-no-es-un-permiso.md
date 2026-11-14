---
title: "Un GUID no es un permiso: lo que no te protege de BOLA, el riesgo número uno de OWASP"
subtitle: Un id imposible de adivinar sigue estando en logs, enlaces y capturas, y la comprobación que falta sigue faltando
description: "BOLA (OWASP API1:2023) en ASP.NET Core: por qué los GUID y los ids ofuscados no sustituyen la autorización por objeto, cuándo devolver 403 o 404 según RFC 9110 y un test de xUnit que falla si un endpoint con id se queda sin comprobar."
date: 2027-01-03
topic: aspnet
series: owasp-api
published: false
---

En el [post anterior](/2027-01-01-bola-tu-api-sabe-quien-eres-pero-no-que-es-tuyo) vimos qué es BOLA y dos formas de corregirlo en una Minimal API: filtrar la consulta por el propietario o cargar el objeto y preguntar a `IAuthorizationService`. Las dos funcionan, y las dos dependen de que alguien se acuerde de aplicarlas en cada endpoint que recibe un id.

Aquí veo dos medidas que parecen protegerte y no lo hacen (los GUID y los ids ofuscados), la duda de si responder `403` o `404` y un test que se pone en rojo cuando un endpoint se olvida de la comprobación.

## Un GUID no es un permiso

A finales de junio de 2025, Ian Carroll y Sam Curry [revisaron McHire](https://ian.sh/mcdonalds), la plataforma de selección de personal de McDonald's. Una API interna recibía un `lead_id` y devolvía los datos del candidato. Su candidato de prueba tenía un id cercano a 64.185.742. Restaron uno y les salieron los datos de otra persona. La base de datos tenía más de 64 millones de solicitantes.

Con ids enteros consecutivos, el ataque es un bucle. Así que la tentación es cambiar los enteros por GUID y darlo por resuelto. entry-hub ya usa GUID desde el principio, generados con `Guid.CreateVersion7()`. Aun así, sin la comprobación del post anterior, cualquier empleado podía leer y cancelar las reservas de los demás.

Todas las fuentes coinciden en que un id difícil de adivinar ayuda pero no basta. El propio [OWASP API1:2023](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/) recomienda preferir valores aleatorios e impredecibles como GUID, pero como medida adicional a la comprobación de autorización, no en su lugar. La [guía de OWASP para prevenir IDOR](https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html) lo dice sin rodeos:

> If attackers obtain URLs for unauthorized objects, the application should still block their access attempts.

Y el estándar que define los UUID, el [RFC 9562](https://www.rfc-editor.org/rfc/rfc9562#section-8), dice esto en su apartado de seguridad:

> Implementations SHOULD NOT assume that UUIDs are hard to guess. For example, they MUST NOT be used as security capabilities (identifiers whose mere possession grants access).

Un GUID impide adivinar un id, pero no que alguien lo vea: aparece en listados de otros endpoints, en los logs, en la cabecera `Referer`, en un enlace reenviado por correo o en la captura de pantalla de una incidencia.

Con la versión 7 hay que tener en cuenta un detalle más. [Según Microsoft](https://learn.microsoft.com/dotnet/core/whats-new/dotnet-9/libraries#systemguid), `Guid.NewGuid()` genera un UUID versión 4 relleno casi por completo de datos aleatorios, mientras que la versión 7 reserva una parte para una marca de tiempo Unix. Eso los hace ordenables, que es bueno para los índices, pero cualquiera que vea el id sabe cuándo se creó el registro. Para una reserva da igual. Para otros datos puede no darlo.

## Ofuscar el entero tampoco

Hay otra alternativa que aparece a menudo: dejar los enteros en la base de datos y enseñarlos codificados en la URL con librerías como Sqids (antes Hashids), que convierten el número en una cadena corta de letras y cifras que parece aleatoria.

La propia [documentación de Sqids](https://sqids.org/faq) advierte que no es una medida de seguridad. Sus ids "are not hashes and could be decoded back into numbers", y del alfabeto barajado que usa dice que, con suficiente esfuerzo, se puede deducir, así que "this is by no means a technique to hide sensitive data". OWASP va en la misma línea y desaconseja cifrar los ids porque es difícil hacerlo de forma segura. Como mucho, ofuscar esconde el contador a simple vista.

## ¿403 o 404?

Cuando Bea pide la reserva de Ana, entry-hub responde `403`, y la consulta acotada del post anterior respondería `404`. Las dos son válidas, aunque la primera le cuenta a Bea algo que la segunda calla.

El [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110#section-15.5.4) define el `403` como la respuesta de un servidor que entendió la petición pero se niega a atenderla. Y del `404` dice que el servidor no encontró el recurso "or is not willing to disclose that one exists". El estándar prevé usar el `404` para no revelar que algo existe.

Un `403` confirma que el id es válido. Con ids consecutivos eso basta para contar registros o saber qué ids probar después. La guía de OWASP recomienda, cuando la existencia del recurso es sensible, usar la consulta acotada y devolver la misma respuesta pública en los dos casos, por ejemplo un `404`.

Mi regla práctica:

- `404` si los ids se pueden enumerar o si el mero hecho de que exista el recurso dice algo. Por ejemplo, un expediente o un usuario con ese correo.
- `403` si los ids no se pueden adivinar y la existencia no es un secreto. Es más fácil de depurar, porque quien llama sabe que el problema es de permisos y no de un id mal copiado.

entry-hub devuelve `403` porque sus ids son GUID y saber que una reserva existe no revela nada. Si las reservas fueran citas médicas, devolvería `404`.

## El test que lo detecta

Ni los GUID ni el código de estado sustituyen a la comprobación, y la comprobación es justo lo que se olvida en el endpoint siguiente. OWASP propone cubrirlo con tests: crea dos usuarios, cada uno con sus objetos, y haz que el primero intente acceder a los del segundo en todas las operaciones con un id. API1:2023 añade:

> Write tests to evaluate the vulnerability of the authorization mechanism. Do not deploy changes that make the tests fail.

En entry-hub son dos tests de integración sobre la API real en memoria, con PostgreSQL y tokens JWT de prueba. El primero ataca cada endpoint que recibe el id de una reserva:

```csharp
private static readonly Dictionary<string, (HttpMethod Method, string Path)> PrivateResourceEndpoints = new()
{
    ["GetBooking"] = (HttpMethod.Get, "/api/v1/bookings/{id}"),
    ["CancelBooking"] = (HttpMethod.Post, "/api/v1/bookings/{id}/cancel"),
};

[Theory]
[MemberData(nameof(PrivateEndpointNames))]
public async Task An_employee_cannot_reach_a_booking_of_someone_else(string endpointName)
{
    using var api = await TestApi.StartAsync();
    using var ana = api.ClientFor($"ana-{Guid.NewGuid():N}", Roles.Employee);
    using var bea = api.ClientFor($"bea-{Guid.NewGuid():N}", Roles.Employee);
    var booking = await NewBookingAsync(api, ana);
    var (method, path) = PrivateResourceEndpoints[endpointName];

    var response = await bea.SendAsync(new HttpRequestMessage(method, path.Replace("{id}", booking.Id.ToString(), StringComparison.Ordinal)));

    Assert.Contains(response.StatusCode, new[] { HttpStatusCode.Forbidden, HttpStatusCode.NotFound });

    var afterwards = await ana.GetFromJsonAsync<BookingResponse>($"/api/v1/bookings/{booking.Id}", TestJson.Options);
    Assert.Equal(BookingStatus.Confirmed, afterwards!.Status);
}
```

Ana crea una reserva, Bea la pide por cada endpoint y el test exige un `403` o un `404`. Acepta los dos a propósito: así sirve igual con la consulta acotada que con `IAuthorizationService`, y lo he comprobado con las dos versiones. La última línea comprueba que la reserva sigue confirmada, porque en una escritura no basta con mirar el código de estado.

Para comprobar que el test sirve, quité la comprobación de `BookingAuthorizationHandler` y lo ejecuté:

```text
Failed ObjectLevelAuthorizationTests.An_employee_cannot_reach_a_booking_of_someone_else(endpointName: "CancelBooking")
 Assert.Contains() Failure: Item not found in collection
Failed ObjectLevelAuthorizationTests.An_employee_cannot_reach_a_booking_of_someone_else(endpointName: "GetBooking")
 Assert.Contains() Failure: Item not found in collection
```

Este test solo vigila los endpoints que alguien añadió a la lista, y el que se olvida es el endpoint nuevo que nadie apunta. Para eso está el segundo test. Recorre los endpoints que la aplicación ha registrado de verdad y exige que cada ruta con un `{id}` esté clasificada como privada (y entonces se ataca) o como compartida:

```csharp
private static readonly HashSet<string> SharedResourceEndpoints = ["GetRoom", "StreamRoomOccupancy"];

[Fact]
public void Every_endpoint_with_an_id_is_classified()
{
    using var api = new ApiFactory(TestDatabase.Unreachable);
    var endpoints = api.Services.GetRequiredService<EndpointDataSource>().Endpoints
        .OfType<RouteEndpoint>()
        .Where(endpoint => endpoint.RoutePattern.Parameters.Any(parameter => parameter.Name == "id"))
        .Select(endpoint => endpoint.Metadata.GetMetadata<IEndpointNameMetadata>()?.EndpointName ?? endpoint.RoutePattern.RawText!)
        .Order(StringComparer.Ordinal)
        .ToList();

    var classified = PrivateResourceEndpoints.Keys.Concat(SharedResourceEndpoints).Order(StringComparer.Ordinal).ToList();

    Assert.Equal(classified, endpoints);
}
```

Las salas son compartidas, porque cualquier empleado puede verlas antes de reservar, así que `GetRoom` y su stream de ocupación van en la segunda lista. Si mañana alguien añade `PUT /bookings/{id}` y no lo apunta, el test falla y obliga a decidir. Esto es lo que sale si quito `GetRoom` de la lista:

```text
Failed ObjectLevelAuthorizationTests.Every_endpoint_with_an_id_is_classified
Expected: ["CancelBooking", "GetBooking", "StreamRoomOccupancy"]
Actual:   ["CancelBooking", "GetBooking", "GetRoom", "StreamRoomOccupancy"]
```

El test no sabe si la decisión es correcta. Alguien podría marcar como compartido algo que no lo es. Pero convierte un olvido silencioso en una decisión que queda en el código y pasa por la revisión de un PR.

## Resumiendo

- Un GUID evita que adivinen los ids, no que los vean. El RFC 9562 prohíbe tratarlos como un permiso, y OWASP los recomienda solo como capa adicional.
- Ofuscar enteros con Sqids o Hashids esconde el contador, pero se puede revertir.
- Responde `404` si los ids se pueden enumerar o la existencia del recurso es sensible, y `403` cuando no.
- Lo que evita que BOLA vuelva es un test que ataca cada endpoint con un id usando otro usuario, más otro que falla cuando aparece un endpoint con id sin clasificar.

El código de los dos tests está en [entry-hub](https://github.com/MookieFumi/entry-hub). El siguiente riesgo de la lista de OWASP es [API2, la autenticación rota](/2027-01-05-broken-authentication-token-caducado).
