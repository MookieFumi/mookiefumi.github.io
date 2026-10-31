---
title: "El repositorio que no necesitas (y cuándo sí)"
subtitle: Tu IRepository con Add, GetById y Update repite lo que EF Core ya hace, y no sabe responder a las preguntas del negocio
description: "Cuándo tiene sentido un repositorio en DDD con EF Core y cuándo sobra: qué dice Evans, qué es DbContext, por qué un IRepository genérico no basta y cómo se ve un repositorio con lenguaje del dominio, con demo en C#."
date: 2026-12-02
topic: desarrollo
series: concepts
published: false
---

Abres un proyecto con EF Core y, en la capa de datos, hay un `IRepository<T>` con `Add`, `GetById`, `GetAll`, `Update`, `Remove` y `SaveChanges`. Es casi un reflejo: se pone en cuanto aparece una base de datos. Y nadie pregunta qué aporta, porque la respuesta suele ser «es lo que se hace».

## Lo que ya hace DbContext

La documentación de la API de Entity Framework Core describe así `DbContext`:

> DbContext is a combination of the Unit Of Work and Repository patterns.

Un `DbContext` ya es una sesión que sigue los cambios de los objetos y los guarda juntos. Un wrapper genérico encima reenvía las llamadas. Esta es la versión de la demo, resumida:

```csharp
public sealed class Repository<T>(BookingsDbContext context) : IRepository<T> where T : class
{
    public async Task<T?> GetByIdAsync(Guid id) => await context.Set<T>().FindAsync(id);

    public void Update(T entity) => context.Set<T>().Update(entity);

    // ...Add, Remove, SaveChanges: one line each
}
```

Ese `Update` ni siquiera hace falta. En la demo cargo una sala, reservo y llamo solo a `SaveChanges`: la reserva queda guardada (`True`), porque el contexto ya seguía la entidad. Y hay un segundo síntoma. Para cargar las reservas junto a cada sala, `GetAllAsync` tuvo que aceptar nombres de propiedades a incluir. Cada entidad pide un `Include` distinto, así que la firma genérica empieza a crecer.

## Qué pedía el patrón

El patrón original es más estrecho que eso. Evans lo define en su *Domain-Driven Design Reference* para los agregados:

> For each type of aggregate that needs global access, create a service that can provide the illusion of an in-memory collection of all objects of that aggregate's root type.

Y añade una condición:

> Provide repositories only for aggregate roots that actually need direct access.

Es decir, uno por raíz de agregado (no uno por tabla ni por entidad) y solo para las que necesitan acceso directo. La otra mitad de la definición importa igual: el acceso a consulta debe estar «expressed in the ubiquitous language». Un `GetAll` genérico no usa el lenguaje de nadie.

## Una pregunta del negocio, un método

El negocio no pregunta «dame todas las salas». Pregunta qué sala está libre de 10:00 a 11:00. Con el repositorio genérico, la respuesta cuesta traer todas las salas con sus reservas y filtrar en memoria: en la demo se cargan 3 salas para quedarse con 1 (`Berlin`).

Un repositorio con lenguaje del dominio hace la pregunta tal cual:

```csharp
public sealed class RoomAgenda(BookingsDbContext context)
{
    public Task<List<Room>> FindFreeRoomsAsync(DateTime start, DateTime end)
    {
        return context.Rooms
            .Where(r => !r.Bookings.Any(b => b.Start < end && start < b.End))
            .ToListAsync();
    }
}
```

Ahora el filtro corre en la base de datos y se cargan las salas que cumplen: 1. Aquí sí hay un repositorio que aporta algo, porque tiene un nombre y una pregunta del dominio, y solo hace lo que ese agregado necesita.

Para cargar y guardar una sala concreta no hace falta nada más que el contexto: `context.Rooms.Include(r => r.Bookings).SingleAsync(...)`, reservar y `SaveChangesAsync()`. Es lo que la demo hace con Berlín, y la reserva se guarda.

## Lo que dicen otras voces

La guía de Microsoft sobre diseño de microservicios con DDD insiste en que no se crea un repositorio por tabla («you should never create a repository for each table in the database») y que el patrón no es obligatorio: dice que «it isn't an essential pattern to implement in a DDD design or even in general .NET development». Para un CRUD simple, la propia guía reconoce que puedes usar directamente `DbContext`, «as many developers do».

Jimmy Bogard va más lejos. Según cita esa guía, no es fan de los repositorios porque «hide the important details of the underlying persistence mechanism», y tampoco suele querer simularlos en pruebas: prefiere tener el test de integración con la base de datos real. Los repositorios, resume la guía, «might be useful, but they are not critical for your DDD design in the way that the Aggregate pattern and a rich domain model are».

## Las lecturas, fuera

Esta misma guía separa las consultas de las operaciones sobre agregados: tiene sentido consultar la base de datos por otros canales (proyecciones, Dapper) porque «queries don't change the state of the database». El repositorio queda para cargar y guardar agregados. Un listado de la pantalla de reservas, con sus joins y su paginación, no tiene por qué pasar por `Room`.

## Cuándo sí

- Si la consulta tiene nombre en el negocio, como `FindFreeRoomsAsync`, ponla en un repositorio con ese nombre.
- Si la carga del agregado tiene reglas propias (qué relaciones incluir, qué filtros aplicar siempre), centralizarlas evita repetirlas.
- Si el modelo debe poder probarse o usarse sin EF Core, una interfaz en el dominio lo permite. La guía de Microsoft cita como ventaja que facilita las pruebas unitarias y añadir decoradores para caché o trazas.

Si ninguna aplica, usa `DbContext`. Y si más adelante alguna aplica, añadirás el repositorio entonces.

El código de las dos versiones, para ejecutar y comparar, está en la carpeta [`14-repository`](https://github.com/MookieFumi/concept-pills/tree/main/14-repository) de concept-pills.
