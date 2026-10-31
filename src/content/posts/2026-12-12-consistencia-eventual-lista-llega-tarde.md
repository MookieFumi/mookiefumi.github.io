---
title: "Consistencia eventual: por qué tu lista llega tarde (y qué hacer con eso)"
subtitle: Reservas, no ves tu reserva, vuelves a reservar y ahora hay dos. El retraso no es el bug; lo es no haberlo diseñado
description: "Qué es la consistencia eventual y cómo diseñar con ella en C#: ventana de inconsistencia, leer tus propias escrituras, qué dicen Vogels y Helland, un ejemplo de reservas de salas con una lista que llega tarde y cuándo exigir consistencia fuerte."
date: 2026-12-12
topic: desarrollo
series: concepts
published: false
---

Reservas una sala y la pantalla «Mi día» no muestra nada. Piensas que ha fallado y reservas otra vez. Ahora hay dos reservas, y un rato después la lista las enseña las dos. Nadie ha escrito mal ninguna línea: había una copia de los datos que iba con retraso, y la aplicación no lo tenía previsto.

## El caso en el que nadie lo ha diseñado

La versión sin diseño tiene dos almacenes que deberían coincidir: las reservas y una copia para la pantalla. Un trabajo en segundo plano refresca la copia más tarde. El código de la demo hace lo que haría un usuario impaciente:

```csharp
Reserve("Planning");
Console.WriteLine($"Screen right after reserving: {screen.Count}");   // 0

// The user does not see it, assumes it failed, and tries again.
if (screen.Count == 0)
{
    Reserve("Planning");
}
```

Resultado: `Screen right after reserving: 0`, `Bookings stored: 2`, y tras el refresco, `Screen after the refresh job: 2`. Los dos almacenes acaban coincidiendo, pero por el camino se coló una reserva duplicada.

## Qué es la consistencia eventual

Werner Vogels, de Amazon, la define como una forma concreta de consistencia débil: el sistema garantiza que «if no new updates are made to the object, eventually all accesses will return the last updated value». Es una garantía de convergencia, no de pérdida de datos. Lo que cambia es que una lectura puede quedarse desfasada durante un rato, y Vogels le pone nombre a ese rato: la ventana de inconsistencia, cuyo tamaño depende de factores como los retrasos de comunicación, la carga del sistema y el número de réplicas.

Vogels presenta esto en el contexto del teorema CAP de Brewer, y con una frase basta. Interesa más otro punto: la consistencia eventual tiene variantes, y una de ellas arregla el caso de arriba.

## Leer tus propias escrituras

La variante se llama *read-your-writes*. Vogels la describe así: tras actualizar un dato, el proceso siempre accede al valor actualizado y nunca ve uno más antiguo. No exige que todos vean el cambio a la vez, solo que quien lo hizo lo vea.

En la versión diseñada, la lista es un modelo de lectura que se actualiza tras la escritura, y el código lo asume:

```csharp
var id = store.Add("Planning", outbox);

Console.WriteLine($"List right after reserving: {screen.Count}");            // 0
Console.WriteLine($"Own booking right after reserving: {store.Find(id)}");   // Planning

projector.RunOnce();
Console.WriteLine($"List after the projector runs: {screen.Count}");         // 1
```

La lista llega tarde y está bien que llegue tarde. Pero la reserva que acabas de hacer se lee de la fuente de verdad, por su identificador, así que el usuario la ve confirmada al instante. Nadie reserva dos veces.

En una aplicación real, esa confirmación suele ser la propia respuesta de la API a la petición (el `Id` y los datos de la reserva) en lugar de volver a consultar la lista.

## Por qué no basta con una transacción

Podrías pensar que lo correcto es meter las dos escrituras en una transacción. Pat Helland, en un artículo de 2007, sostiene que en sistemas a gran escala las transacciones atómicas no cruzan entidades. Cada entidad debe vivir en un único ámbito de serializabilidad (una máquina o un clúster) y la coordinación entre entidades se hace con mensajes. Es un *position paper*: él mismo avisa de que son opiniones personales. Pero describe lo que pasa cuando los datos están en varios sitios.

La guía de Microsoft lo dice como principio de diseño: «Embrace eventual consistency. When data is distributed, it takes coordination to enforce strong consistency guarantees». Coordinar cuesta, y la consistencia eventual es la forma de no pagarlo en cada operación. Y, cuando separas lectura y escritura como en el post anterior, Microsoft avisa de los escenarios en los que el usuario actúa sobre datos desfasados.

## Cuándo exigir consistencia fuerte

No todo puede ir con retraso. La regla de que dos reservas no se solapen debe ser exacta en cada instante. Eso es una invariante, y vive dentro de un agregado, como vimos en el [post de agregados](/2026-11-28-agregados-trozo-de-modelo-consistente). La pantalla «Mi día», en cambio, es una vista derivada. Una pregunta lo decide: ¿qué pasa si el usuario ve el dato con unos segundos de retraso? Si la respuesta es «nada grave», es una vista. Si es «se vende dos veces lo mismo», pertenece al lado fuerte.

La consistencia eventual obliga además a tener en cuenta los mensajes repetidos. Helland señala que la mayoría de las aplicaciones usan mensajería *at-least-once*, así que el receptor suele recordar qué mensajes ya procesó para que reintentar no haga daño. De eso va el siguiente post, sobre idempotencia.

El código de las dos versiones, para ejecutar y comparar, está en la carpeta [`19-eventual-consistency`](https://github.com/MookieFumi/concept-pills/tree/main/19-eventual-consistency) de concept-pills.
