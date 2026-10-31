---
title: "Cómo hablar con un sistema ajeno sin adoptar su idioma"
subtitle: El calendario de la empresa llama "3" a lo cancelado, y ese 3 ya está en media docena de ficheros tuyos
description: "Qué es una capa anticorrupción en DDD y cómo implementarla en C#: un traductor en la frontera con un sistema externo, qué es un context map, un ejemplo de reservas de salas y cuándo basta un simple mapeo."
date: 2026-12-04
topic: desarrollo
series: concepts
published: false
---

Integras tu aplicación de reservas con el calendario de la empresa (un proveedor inventado para la demo, pero con el aspecto de muchos reales). Su API devuelve eventos con un campo `Stat`, donde 1 es confirmado, 2 provisional, 3 cancelado y 9 «borrado por un administrador». Las fechas llegan como texto (`"202601121000"`) y la duración en minutos. Para salir del paso, tu código lee esos campos tal cual.

## Cómo se cuela el idioma ajeno

Esto es lo que hace el informe de agenda cuando usa el evento externo directamente:

```csharp
public int CountActiveBookings()
{
    return calendar.GetEvents().Count(e => e.Stat != 3);
}

public string FirstEndTime()
{
    var first = calendar.GetEvents()[0];
    var start = DateTime.ParseExact(first.Dt, "yyyyMMddHHmm", CultureInfo.InvariantCulture);
    return start.AddMinutes(first.Dur).ToString("HH:mm", CultureInfo.InvariantCulture);
}
```

Hay tres eventos: uno confirmado, uno cancelado (3) y uno borrado por un administrador (9). El informe cuenta 2 reservas activas, cuando solo hay 1: ese 9 pasó la comprobación `!= 3` y nadie lo notó. Nada falló y el número es incorrecto. Además, el `3` y el formato de fecha están en cada sitio que toca un evento, así que cuando el proveedor añada un estado nuevo habrá que revisarlos todos.

## Qué es una capa anticorrupción

Evans lo resuelve con un patrón de su *Domain-Driven Design Reference*, la capa anticorrupción:

> As a downstream client, create an isolating layer to provide your system with functionality of the upstream system in terms of your own domain model. This layer talks to the other system through its existing interface, requiring little or no modification to the other system. Internally, the layer translates in one or both directions as necessary between the two models.

Dos ideas. La primera: es una capa propia, que habla con el otro sistema por su interfaz tal como es, sin pedirle cambios. La segunda: traduce a tu modelo, con tus palabras. Eso la distingue de copiar campos de un lado a otro. La guía de Azure resume su propósito en una frase: «The core purpose of an anti-corruption layer is to protect the domain model».

## El traductor en la frontera

En el ejemplo, el dominio define lo que necesita, en su idioma:

```csharp
public interface IBookingSource
{
    IReadOnlyList<Booking> GetBookings();
}
```

`Booking` tiene `Start`, `End` y un `BookingStatus` de verdad (`Confirmed`, `Tentative`, `Cancelled`). El informe usa `IBookingSource`, y no sabe que existe un calendario externo.

Quien conoce al proveedor es una clase aparte:

```csharp
private static BookingStatus ToStatus(ExternalEvent e)
{
    return e.Stat switch
    {
        1 => BookingStatus.Confirmed,
        2 => BookingStatus.Tentative,
        3 or 9 => BookingStatus.Cancelled,
        _ => throw new InvalidOperationException($"Unknown status {e.Stat} in event {e.Id}."),
    };
}
```

Con ella, el mismo informe cuenta 1 reserva activa. Los códigos se leen en un solo sitio, y ahí se decidió que el 9 cuenta como cancelado. Si un día llega un `Stat` desconocido, falla con un mensaje claro, en lugar de sumar un número equivocado. La interfaz vive en el dominio y la implementación en infraestructura, como el repositorio del [post anterior](/2026-12-02-repositorio-que-no-necesitas): el dominio no depende de nadie.

Un cuidado que recomienda la guía de Azure: en esta capa va solo traducción. Nada de reglas de negocio ni de orquestación, que pertenecen al dominio.

## El mapa de contextos

Una capa anticorrupción es una de las formas en que dos contextos se relacionan. Para tenerlas a la vista, Evans propone el context map:

> Identify each model in play on the project and define its bounded context... Describe the points of contact between the models, outlining explicit translation for any communication, highlighting any sharing, isolation mechanisms, and levels of influence.

Cada contexto, con su nombre; cada punto de contacto, con la traducción que hace y quién manda en la relación. Fowler lo recomienda al hablar de bounded contexts: «It's usually worthwhile to depict these using a context map». En este ejemplo el mapa tiene dos cajas, reservas y calendario externo, y una flecha con la capa anticorrupción en medio. En el [post de bounded context](/2026-11-24-bounded-context-donde-acaba-tu-modelo) vimos dos contextos dentro de la misma aplicación. Aquí el segundo es de otro equipo, o de otra empresa, y no puedes cambiarlo.

## Cuándo basta un mapeo simple

No siempre hace falta. La guía de Azure lo dice sin rodeos para el caso en que los dos sistemas «have no significant semantic differences», y pide centrar la capa en la traducción. Si el modelo ajeno es estable y encaja con el tuyo, adoptarlo tal cual (la relación que en un context map se llama *conformist*) es más barato y legítimo. Una capa merece la pena cuando el modelo del otro lado es distinto, cambia fuera de tu control o acabaría repartido por todo tu código.

Y no es lo mismo que un AutoMapper: copiar campos no traduce significado. Lo que protege al modelo es decidir, por ejemplo, qué es «cancelado».

## Cierre de la serie

Con esta píldora acaba la serie de DDD. Empezamos con el [lenguaje ubicuo](/2026-11-22-lenguaje-ubicuo-codigo-negocio) y cerramos con la forma de protegerlo en la frontera. Entre medias: los límites del [bounded context](/2026-11-24-bounded-context-donde-acaba-tu-modelo), la pregunta de [identidad y valor](/2026-11-26-identidad-y-valor), los [agregados](/2026-11-28-agregados-trozo-de-modelo-consistente), los [eventos de dominio](/2026-11-30-eventos-de-dominio) y el [repositorio](/2026-12-02-repositorio-que-no-necesitas).

El código de las dos versiones, para ejecutar y comparar, está en la carpeta [`15-anti-corruption-layer`](https://github.com/MookieFumi/concept-pills/tree/main/15-anti-corruption-layer) de concept-pills.
