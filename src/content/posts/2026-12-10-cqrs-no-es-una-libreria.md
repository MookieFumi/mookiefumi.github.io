---
title: "CQRS no es una librería (ni dos bases de datos)"
subtitle: Para pintar una lista de salas cargas todas las reservas de todas las salas, y el modelo que las protege no sirve para eso
description: "Qué es CQRS de verdad y cómo aplicarlo en C# con EF Core sin MediatR, sin bus de mensajes y sin dos bases de datos: un modelo para escribir y otro para leer, con una demo de reservas de salas y cuándo no usarlo."
date: 2026-12-10
topic: desarrollo
series: concepts
published: false
---

La pantalla de salas muestra una fila por sala: nombre, número de reservas y cuándo termina la última. Para pintarla cargas cada `Room` con todas sus reservas, las cuentas en memoria y descartas el resto. Son tres filas, y lees quince objetos.

## El coste de usar el mismo modelo para todo

La sala de la demo es un agregado: protege la regla de solapes y por eso se carga entera. Eso está bien para reservar. Para pintar una lista, es lo contrario de lo que necesitas:

```csharp
var rooms = await context.Rooms.Include(r => r.Bookings).ToListAsync();

return rooms
    .Select(r => new RoomOccupancyRow(r.Name, r.Bookings.Count, r.Bookings.Max(b => (DateTime?)b.End)))
    .ToList();
```

Con 3 salas y 4 reservas por sala, el contexto de EF Core acaba siguiendo 15 entidades (3 salas y 12 reservas) para devolver 3 filas. Es el mismo modelo haciendo dos trabajos que piden cosas distintas: escribir exige reglas y consistencia, y leer exige formas cómodas para la pantalla.

## Qué es CQRS

Martin Fowler lo resume así: «At its heart is the notion that you can use a different model to update information than the model you use to read information». Greg Young, que lo describió, parte del principio de separación de comandos y consultas de Bertrand Meyer, y explica la diferencia: en CQRS los objetos se dividen en dos, uno con los comandos y otro con las consultas. Young cuenta además que, tras mucha confusión entre ambos conceptos, se acabó considerando que CQRS era un patrón distinto de CQS.

Nada de esto menciona librerías, buses ni bases de datos separadas. Microsoft lo aclara: «Messaging isn't a requirement for CQRS».

## Dos modelos, una base de datos

En la demo, el lado de las consultas tiene su propio modelo, con la forma de la pantalla, y una proyección directa:

```csharp
public Task<List<RoomOccupancyRow>> LoadAsync()
{
    return context.Rooms
        .AsNoTracking()
        .Select(r => new RoomOccupancyRow(r.Name, r.Bookings.Count, r.Bookings.Max(b => (DateTime?)b.End)))
        .ToListAsync();
}
```

Al ejecutarlo salen las mismas 3 filas y el contexto sigue **0** entidades. El agregado ni se entera. El lado de los comandos sigue como antes: carga la sala, deja que `Book` aplique la regla y guarda. Al intentar reservar encima de otra reserva, el resultado es `False`: las reglas siguen donde estaban.

Es CQRS en su versión más pequeña: una base de datos, un proceso y dos clases que hacen cada una su trabajo.

## Lo que CQRS no es

- **No es MediatR.** MediatR es un mediador en proceso, una forma de enviar peticiones a manejadores. Puedes separar comandos y consultas sin él, y puedes usar MediatR sin separar nada. Desde julio de 2025 tiene ediciones comerciales, con una versión Community gratuita para empresas e individuos con menos de 5 millones de dólares de ingresos anuales, según anunció su autor, Jimmy Bogard.
- **No es event sourcing.** Se combinan bien, pero son temas distintos. Microsoft avisa de que unir ambos puede añadir complejidad importante y que, para la mayoría de los sistemas, la gestión de datos tradicional basta.
- **No obliga a dos bases de datos.** Eso es una decisión posterior, para cuando un volumen de lecturas lo justifique, y trae consigo la consistencia eventual del siguiente post.

Un matiz de vocabulario: Bogard dice que, como su sistema se divide limpiamente en peticiones de comando y de consulta, usar vertical slice le da «CQRS out of the gate». Él usa el término en un sentido más amplio (separar peticiones), mientras que Young y Fowler hablan de modelos separados. Ambos usos circulan, y conviene saber cuál usa quien te habla.

## Cuándo no

Fowler es claro: CQRS es valioso en algunas situaciones, pero «for most systems CQRS adds risky complexity». Y añade que la mayoría de los casos en que lo ha visto no han sido buenos, y que solo debería usarse en partes concretas de un sistema (un bounded context) y no en todo. Microsoft coincide: no encaja cuando las reglas del dominio son simples o basta un CRUD.

Una pregunta sirve para decidir: ¿tus lecturas piden una forma que tu modelo de escritura no tiene? Si tu pantalla pinta lo mismo que guardas, un solo modelo es lo correcto. Si cargas objetos enteros para mostrar tres campos, o tu modelo de dominio se deforma para servir a las listas, separa solo ese caso.

El código de las dos versiones, para ejecutar y comparar, está en la carpeta [`18-cqrs`](https://github.com/MookieFumi/concept-pills/tree/main/18-cqrs) de concept-pills.
