---
title: Lo que pidió el negocio y lo que añadimos nosotros
subtitle: La regla del negocio cabe en una línea, pero el código que la aplica la esconde entre diccionarios, códigos de error y un flag temporal
description: "Complejidad esencial y accidental en C# con un ejemplo de validación de reservas de salas: la distinción de Brooks, cómo separar la regla del negocio del ruido propio y qué quiso decir Ward Cunningham con deuda técnica."
date: 2026-11-24
topic: desarrollo
series: concepts
published: false
---

La regla del negocio cabe en una frase: una reserva dura entre 15 minutos y 4 horas. Este es el código que la aplica:

```csharp
public static string Check(Dictionary<string, object?> data)
{
    if (!data.TryGetValue("start", out var startValue) || startValue is null)
    {
        return "ERR1";
    }

    if (!data.TryGetValue("end", out var endValue) || endValue is null)
    {
        return "ERR2";
    }

    var start = DateTimeOffset.Parse(startValue.ToString()!, CultureInfo.InvariantCulture);
    var end = DateTimeOffset.Parse(endValue.ToString()!, CultureInfo.InvariantCulture);
    var minutes = (end - start).TotalMinutes;

    // TODO: remove when the old mobile app is gone
    if (data.ContainsKey("legacy") && (bool)data["legacy"]!)
    {
        return minutes >= 15 ? "OK" : "ERR3";
    }

    return minutes >= 15 && minutes <= 240 ? "OK" : "ERR3";
}
```

Probado con tres reservas, el resultado es este:

```text
ERR3    (5 minutos)
ERR3    (4 horas y media)
OK      (4 horas y media, con "legacy")
```

La última línea es la sorpresa: con el flag `legacy`, una reserva de cuatro horas y media pasa. Según el comentario, es una excepción para una aplicación móvil antigua, y el `TODO` que pide quitarla sigue ahí.

## Esencial y accidental

En 1986, Fred Brooks escribió «No Silver Bullet» y dividió las dificultades del software en dos tipos:

> Following Aristotle, I divide them into essence, the difficulties inherent in the nature of the software, and accidents, those difficulties which today attend its production but which are not inherent.

La esencia es lo que el problema exige: aquí, que una reserva dure entre 15 minutos y 4 horas. Lo accidental es todo lo que añadimos al construirlo. Si miras el método de arriba con esa división, casi nada es esencial:

- Un `Dictionary<string, object?>` como entrada, que obliga a comprobar claves y a convertir tipos.
- Fechas que llegan como texto y se parsean dentro de la validación.
- Códigos `ERR1`, `ERR2` y `ERR3` que nadie puede interpretar sin leer el código.
- Un flag temporal que ha acabado cambiando la regla.
- Los minutos en bruto (`240`) donde el negocio dice «4 horas».

## Dejar solo lo esencial

La versión con la complejidad accidental fuera:

```csharp
public static class BookingDuration
{
    public static readonly TimeSpan Minimum = TimeSpan.FromMinutes(15);

    public static readonly TimeSpan Maximum = TimeSpan.FromHours(4);

    public static string? Check(DateTimeOffset start, DateTimeOffset end)
    {
        var duration = end - start;

        if (duration < Minimum)
        {
            return $"A booking lasts at least {Minimum.TotalMinutes:0} minutes.";
        }

        return duration > Maximum ? $"A booking lasts at most {Maximum.TotalHours:0} hours." : null;
    }
}
```

La entrada tiene tipo (en el post sobre value objects esto sería un `TimeRange`), la regla tiene nombre, el mínimo y el máximo son constantes que se leen como las dice el negocio, y el mensaje explica qué falla. Con las mismas tres reservas el resultado es `A booking lasts at least 15 minutes.`, `A booking lasts at most 4 hours.` y `OK` para la de una hora. El flag `legacy` ha desaparecido: la excepción para la aplicación antigua, si sigue haciendo falta, tiene que volver como una decisión explícita con dueño, no como un parche escondido.

## Qué es la deuda técnica

La respuesta habitual es «código sucio que escribimos con prisa». Ward Cunningham, que introdujo el término en 1992, lo contó de otra manera:

> Shipping first time code is like going into debt. A little debt speeds development so long as it is paid back promptly with a rewrite.

En 2009 aclaró que había visto la metáfora mal explicada: «I'm never in favor of writing code poorly». Su idea era escribir el código que refleje lo que entiendes ahora del problema, aunque sea parcial, y reescribirlo cuando aprendes más. Eso solo funciona si el código es lo bastante limpio para poder reformarse. El `legacy` del ejemplo no encaja en ese sentido: es una excepción que se quedó escondida dentro de la regla.

Cuando algo te parezca raro en un método de validación, una pregunta ayuda a ordenar: ¿esto lo pidió el negocio o lo hemos añadido nosotros? Lo primero hay que conservarlo y nombrarlo bien. Lo segundo es lo que se puede simplificar.

## Las ocho píldoras

Con esta se cierra la serie de diseño del código, con el mismo ejemplo de reservas de salas en todas:

1. [Herencia o composición sin dogmas: cuándo cada una](/2026-11-10-herencia-o-composicion-sin-dogmas)
2. [El test que solo falla por la tarde](/2026-11-12-test-que-solo-falla-por-la-tarde)
3. [Pregunta menos, ordena más: quién debe saber si algo encaja](/2026-11-14-pregunta-menos-ordena-mas)
4. [Primitive obsession: dale nombre a tus datos con value objects, sin ceremonia](/2026-11-16-value-objects-sin-ceremonia)
5. [Dónde viven las reglas de tu negocio](/2026-11-18-donde-viven-las-reglas-de-tu-negocio)
6. [Inmutabilidad: lo que ve quien solo quería leer](/2026-11-20-inmutabilidad-lo-que-ve-quien-solo-queria-leer)
7. [SOLID sin sermones: dos principios y una regla nueva](/2026-11-22-solid-sin-sermones)
8. Esta.

El código de las dos versiones, para ejecutar y comparar, está en la carpeta [`08-essential-complexity`](https://github.com/MookieFumi/concept-pills/tree/main/08-essential-complexity) de concept-pills.
