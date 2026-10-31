---
title: "Tu ORM escribe SQL por ti. ¿Lo has leído alguna vez?"
subtitle: Qué es Entity Framework Core, qué sabores tiene y qué te cobra a cambio de lo que te da
description: "Qué es Entity Framework Core: LINQ a SQL, tracking de cambios y migraciones; diferencias con EF6, proveedores de bases de datos y cuándo conviene más Dapper o SQL a mano."
date: 2026-10-10
topic: dotnet
series: ef-core
published: false
---

Entity Framework Core es el ORM de Microsoft para .NET. Un ORM (object-relational mapper) convierte las filas de una base de datos en objetos de tu código y, al revés, los cambios en esos objetos en sentencias SQL. Con EF Core escribes consultas en LINQ, y la librería las traduce a SQL, las ejecuta y te devuelve instancias de tus clases.

Esta serie son ocho píldoras sobre errores que castigan a la base de datos sin que el código lo avise. Antes de empezar con ellos conviene tener claro qué hace EF por ti, qué versiones y proveedores existen y qué cuesta.

## Lo que hace por ti

Este es el código que escribes para listar los 2.000 primeros pedidos con su estado y su total:

```csharp
var rows = await db.Orders
    .OrderBy(o => o.Id)
    .Take(2000)
    .Select(o => new OrderRow(o.Id, o.Status, o.Total))
    .ToListAsync();
```

Y este es el SQL que EF Core genera (salida real de la demo de la serie, sobre SQLite):

```sql
SELECT "o"."Id", "o"."Status", "o"."Total"
FROM "Orders" AS "o"
ORDER BY "o"."Id"
LIMIT @p
```

De ahí salen las ventajas que más se usan:

- LINQ tipado. El compilador revisa los nombres de propiedades y los tipos. Un renombrado de columna deja de ser una cadena en una consulta que falla en producción.
- Tracking de cambios. EF recuerda cómo estaba cada entidad que cargó. Cuando llamas a `SaveChanges`, compara y genera solo los `UPDATE`, `INSERT` y `DELETE` necesarios.
- Migraciones. Los cambios en el modelo se convierten en scripts versionados que se aplican a la base de datos.
- Concurrencia optimista, transacciones, interceptores y logging integrados.
- Un solo modelo para varias bases de datos. Cambias de proveedor y casi todo el código de consultas sigue valiendo.

## Los sabores

### EF Core y EF6

Hay dos productos con nombre parecido. EF6 nació para .NET Framework y la documentación de Microsoft lo describe como estable y soportado, pero sin desarrollo activo. EF Core es la versión moderna y es donde llegan las novedades. La guía oficial es usar EF Core en toda aplicación nueva, salvo que necesites algo que solo existe en .NET Framework. Si tienes una aplicación EF6 estable, la recomendación es mantenerla; migrar a EF Core tiene sentido cuando el acceso a datos evoluciona o necesitas funciones que solo tiene EF Core. No es un cambio de paquete: la propia documentación avisa de que hay que tocar código.

Cosas que EF6 tiene y EF Core no tendrá: el diseñador visual y el formato EDMX. En el otro lado, EF Core aporta, entre otras, `ExecuteUpdate` y `ExecuteDelete` (EF Core 7), proveedores nuevos y soporte de JSON en columnas.

### Proveedores

EF Core llega a cada base de datos a través de un proveedor, un paquete NuGet. Los principales:

| Base de datos | Paquete | Lo mantiene |
|---|---|---|
| SQL Server y Azure SQL | `Microsoft.EntityFrameworkCore.SqlServer` | Equipo de EF Core |
| SQLite | `Microsoft.EntityFrameworkCore.Sqlite` | Equipo de EF Core |
| Azure Cosmos DB | `Microsoft.EntityFrameworkCore.Cosmos` | Equipo de EF Core |
| PostgreSQL | `Npgsql.EntityFrameworkCore.PostgreSQL` | Equipo de Npgsql |
| MySQL y MariaDB | `Pomelo.EntityFrameworkCore.MySql` | Pomelo Foundation |
| Oracle | `Oracle.EntityFrameworkCore` | Oracle |
| MongoDB | `MongoDB.EntityFrameworkCore` | MongoDB |

Hay más, muchos de ellos de pago. Dos advertencias de la documentación oficial. La primera: no todos los proveedores los mantiene el equipo de EF Core, así que hay que evaluar calidad, licencia y soporte de cada uno. La segunda: un proveedor de una versión mayor no funciona con la siguiente. Si subes a EF Core 10, el proveedor tiene que tener su versión para EF Core 10, y los de terceros pueden tardar en tenerla.

Aparte está el proveedor `InMemory`, que sirve para pruebas y tiene limitaciones importantes: no es una base de datos relacional y no se comporta como una. Para tests que se parezcan a producción es mejor usar la base de datos real (por ejemplo, con Testcontainers) o SQLite.

### Dos formas de empezar

Con code-first escribes las clases y EF genera el esquema mediante migraciones. Con database-first partes de una base de datos que ya existe y `dotnet ef dbcontext scaffold` genera las clases y el contexto. Ambas son válidas; la segunda es la habitual cuando heredas una base de datos con años encima.

## Lo que cuesta

EF Core no es gratis. Estas son las pegas reales:

- La abstracción gotea. Escribes LINQ, pero lo que se ejecuta es SQL, y la diferencia entre una consulta rápida y una que tumba la base de datos está en el SQL. Las ocho píldoras siguientes tratan justo de eso.
- El tracking está activado por defecto, y en consultas de solo lectura es trabajo que no sirve de nada.
- Es fácil lanzar muchas consultas sin darse cuenta. Un bucle que toca una propiedad de navegación puede convertirse en cientos de viajes a la base de datos.
- No todo se traduce a SQL. Si el proveedor no sabe traducir un método, EF lanza una excepción en tiempo de ejecución, no en compilación.
- Hay que conocer la base de datos. Los índices, los planes de ejecución y el orden de las filas siguen importando. EF no los arregla.

## EF Core, Dapper o SQL a mano

No hay una respuesta única, pero esta tabla ayuda a decidir:

| Necesitas | Encaja mejor |
|---|---|
| Modelo de dominio con relaciones, migraciones y escrituras con control de cambios | EF Core |
| Consultas de lectura complejas con SQL muy afinado | Dapper o SQL a mano (EF también permite `FromSql`) |
| Informes y cargas masivas | SQL a mano o utilidades específicas de la base de datos |
| Las dos cosas a la vez | EF Core para escribir y consultas SQL para leer |

Mucho código real mezcla las dos cosas, y no pasa nada. EF Core incluso permite componer SQL propio con LINQ.

## Mirar el SQL

El hábito más útil con EF Core es leer el SQL que genera. Hay dos formas rápidas de hacerlo:

```csharp
// Print the SQL of a single query.
Console.WriteLine(query.ToQueryString());

// Log every command EF sends (development only).
optionsBuilder.LogTo(Console.WriteLine, LogLevel.Information);
```

Con `ToQueryString()` ves la consulta sin ejecutarla. Con `LogTo` ves todo lo que se envía a la base de datos, incluido el número de comandos por petición. Si ese número te sorprende, ya tienes el problema delante.

El código de las demos de toda la serie está en [ef-core-pills](https://github.com/MookieFumi/ef-core-pills): una base SQLite con 20.000 pedidos y un millón de envíos para poder ver cada problema con números reales. La siguiente píldora empieza por el más frecuente: el N+1.
