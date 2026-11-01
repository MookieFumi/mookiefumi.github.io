---
title: "Outbox transaccional: la reserva está guardada y nadie se ha enterado"
subtitle: Guardas en la base de datos, publicas en el broker, y entre una cosa y otra se te cae el mundo
description: "Qué es el patrón Transactional Outbox y cómo implementarlo en C# con EF Core: guardar el mensaje en la misma transacción que los datos, un relay que lo publica, por qué no da exactly-once y qué hacen MassTransit, NServiceBus y Wolverine."
date: 2026-12-20
topic: desarrollo
series: concepts
published: false
---

Guardas la reserva en la base de datos y, justo después, publicas un mensaje para que catering y recordatorios se enteren. Si el broker está caído en ese segundo, la petición falla, pero la reserva ya está guardada. En tu base de datos existe una reserva de la que ningún otro servicio sabrá nada.

## Dos escrituras, ninguna transacción común

Esta es la versión ingenua, la que sale de forma natural:

```csharp
context.Bookings.Add(booking);
await context.SaveChangesAsync();

// Two systems, two writes, no shared transaction.
broker.Publish(booking.Id);
```

En la demo el broker está caído. Salida: `The request failed: the broker was down.`, `Bookings in the database: 1` y `Messages the other services received: 0`. Un fallo a medias que nadie va a arreglar: no hay ningún reintento que sepa que falta un mensaje.

El orden inverso (publicar antes de guardar) tiene el problema contrario: si la base de datos falla, el mensaje ya se ha ido. La documentación de NServiceBus les pone nombre: *zombie record* (el dato existe, el mensaje no) y *ghost message* (el mensaje existe, el dato no).

## Qué dice el patrón

Chris Richardson describe el problema como cómo actualizar atómicamente la base de datos y enviar mensajes a un broker. Y descarta el camino obvio: las transacciones distribuidas (2PC) no son una opción, porque la base de datos o el broker pueden no soportarlas. Su solución, el *Transactional Outbox*, es que el servicio guarde primero el mensaje en la base de datos, como parte de la misma transacción que actualiza las entidades de negocio, y que un proceso aparte lo envíe al broker.

Sus fuerzas lo resumen bien: si la transacción se confirma, los mensajes deben enviarse; si se revierte, no. Y deben salir en el orden en que el servicio los generó.

## La reserva y el mensaje, juntos

En la versión con outbox, el servicio no habla con el broker. Añade una fila a una tabla de mensajes en la misma transacción:

```csharp
context.Bookings.Add(booking);

// The message is stored in the same transaction as the booking.
context.Outbox.Add(new OutboxMessage(booking.Id));

await context.SaveChangesAsync();
```

O se guardan las dos cosas o no se guarda ninguna. Un *relay* aparte, que en producción sería un servicio en segundo plano, lee los mensajes pendientes, los publica y los marca como procesados.

## Lo que el outbox no promete

La demo lo fuerza a propósito. Primero, el broker sigue caído: el relay falla y el mensaje queda pendiente (`Pending after the broker failure: 1`). Después el broker vuelve, entrega el mensaje, pero pierde la confirmación: el relay no sabe que llegó, lo deja pendiente y lo reenvía. Resultado: `Copies received by the broker: 2`.

El outbox garantiza que el mensaje no se pierde, no que llegue una sola vez. Microsoft lo dice sin rodeos: casi todos los brokers (Azure Service Bus, Event Hubs, Kafka, RabbitMQ) ofrecen entrega *at-least-once*, y es poco práctico garantizar *exactly-once* en un sistema distribuido. La combinación de at-least-once y un consumidor que ignora los duplicados da un procesamiento *effectively-once*. A ese consumidor, del lado de recibir, Microsoft lo llama el patrón Inbox, el compañero del outbox. En la demo, el consumidor recuerda los identificadores y procesa **1** mensaje de las 2 copias. Es la misma idea de la clave del [post de idempotencia](/2026-12-18-idempotencia-doble-clic-reintento), ahora en el lado del consumidor.

## Y las librerías

No tienes que escribir el relay a mano. Varias librerías de .NET lo implementan, con matices:

- **MassTransit** ofrece un *bus outbox* que añade los mensajes publicados al `DbContext`, y un *consumer outbox* que combina bandeja de entrada y de salida para garantizar un comportamiento exactly-once del consumidor. Avisan de que no sustituye a un broker duradero, a las políticas de reintento ni a la lógica de negocio idempotente. Ojo con la licencia: en la web oficial, la versión 9 se presenta como producto comercial.
- **NServiceBus** simula una transacción atómica entre el almacén de datos y la cola, y afirma que cada mensaje se procesa una sola vez, deduplicando por `MessageId`. Dentro de su alcance, outbox más base de datos; no contradice a Microsoft, que habla de extremo a extremo.
- **Wolverine** usa la persistencia de mensajes en la propia base de datos de tu aplicación, y con EF Core se integra con `AddDbContextWithWolverineIntegration`.

No las equiparo: difieren en dónde deduplican y cómo releen. Léelas con ese filtro.

## Un cuidado con EF Core

Si activas los reintentos de conexión de EF Core (`EnableRetryOnFailure`) y abres tú la transacción, tienes que hacerlo dentro de la estrategia de ejecución, o EF lanza una `InvalidOperationException`. En mi demo no hace falta, porque `SaveChangesAsync` ya es una única transacción.

## Cuándo no hace falta

Si tu aplicación no publica eventos a otros sistemas, o puede permitirse perder alguno, un outbox es maquinaria de más. Si publicas y perder un mensaje es un problema real, es el patrón estándar. Para decidir, pregúntate: ¿qué pasa si la reserva existe y nadie se entera?

El código de las dos versiones, para ejecutar y comparar, está en la carpeta [`21-outbox`](https://github.com/MookieFumi/concept-pills/tree/main/21-outbox) de concept-pills.
