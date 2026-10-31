---
title: "Tu ORM escribe SQL por ti. ¿Lo has leído alguna vez?"
subtitle: Qué es Entity Framework Core, cómo empezar con él (code first o database first) y qué te cobra a cambio de lo que te da
description: "Qué es Entity Framework Core: LINQ a SQL, tracking de cambios y migraciones; code first y database first, proveedores de bases de datos y cuándo conviene más Dapper o SQL a mano."
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

## Los sabores: code first y database first

EF Core se puede usar de dos maneras, según de dónde salga la verdad sobre el esquema: de tu código o de la base de datos.

### Code first

Escribes las clases de C# y el contexto, y EF genera el esquema a partir de ellas mediante migraciones:

```bash
dotnet ef migrations add AddOrders
dotnet ef database update
```

Cada migración es un fichero de código que describe un cambio de esquema. Va al control de versiones con el resto del proyecto, se revisa en una pull request y se aplica igual en desarrollo, en CI y en producción. Si quieres ver el SQL antes de aplicarlo, `dotnet ef migrations script` lo genera.

Es la opción natural cuando el proyecto es nuevo o cuando tu aplicación es la dueña de la base de datos. El coste: el esquema pasa a depender del modelo, y renombrar una propiedad puede acabar como un borrado y una creación de columna si no revisas la migración.

### Database first

Aquí la base de datos ya existe y la manda ella. EF lee las tablas y genera las clases y el contexto con `scaffold`:

```bash
dotnet ef dbcontext scaffold "Data Source=pills.db" Microsoft.EntityFrameworkCore.Sqlite -o Models
```

Lo probé con la base de datos de la demo de la serie. Genera una clase por tabla (`Order`, `OrderLine`, `Payment`...), las propiedades de navegación entre ellas, los índices en el contexto y todo marcado como `partial`:

```csharp
public partial class Order
{
    public int Id { get; set; }
    public string Status { get; set; } = null!;
    public virtual Customer Customer { get; set; } = null!;
    public virtual ICollection<OrderLine> OrderLines { get; set; } = new List<OrderLine>();
}
```

Es lo que encaja cuando heredas una base de datos con años encima, cuando la gestiona otro equipo o cuando varias aplicaciones comparten el esquema y los cambios se hacen con scripts SQL.

La pega: el código generado se regenera. Si lo editas a mano y vuelves a ejecutar `scaffold`, pierdes los cambios. Por eso las clases salen `partial` y el contexto trae un método `OnModelCreatingPartial`: tus añadidos van en otro fichero y sobreviven a cada regeneración.

### Cuál elegir

| Situación | Encaja mejor |
|---|---|
| Proyecto nuevo, la aplicación es dueña de los datos | Code first |
| Base de datos existente, gestionada por otros | Database first |
| Esquema compartido entre varias aplicaciones | Database first |
| Quieres el esquema versionado junto al código | Code first |

No es una decisión de por vida. Un camino habitual es hacer un `scaffold` inicial de una base de datos que ya existe y, a partir de ahí, seguir con migraciones como en code first.

## Proveedores

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

El hábito más útil con EF Core es leer el SQL que genera. Hay dos formas de hacerlo.

La primera es el logging de la propia aplicación. EF Core se integra con `Microsoft.Extensions.Logging`, el mismo sistema que usa el resto de ASP.NET Core. Si registras el contexto con `AddDbContext`, usa por defecto la configuración de logging de la aplicación, sea la consola, Serilog o lo que tengas. Solo hay que subir el nivel de la categoría que registra los comandos, en `appsettings.Development.json`:

```json
{
  "Logging": {
    "LogLevel": {
      "Microsoft.EntityFrameworkCore.Database.Command": "Information"
    }
  }
}
```

A partir de ahí cada comando que EF envía a la base de datos aparece en el log con su SQL, sus parámetros y lo que ha tardado. Si quieres ver también los valores de los parámetros, añade `EnableSensitiveDataLogging()` al registrar el contexto, solo en desarrollo, porque esos valores pueden ser datos personales. Y como es una categoría más del log, en producción lo apagas con el mismo mecanismo.

La segunda es `ToQueryString()`, para una consulta concreta y sin ejecutarla. Es lo que usas mientras la escribes, o en un test:

```csharp
var query = db.Orders.Where(o => o.Status == "Pending");
var sql = query.ToQueryString();
```

Con el log ves todo lo que se envía a la base de datos, incluido el número de comandos por petición. Si ese número te sorprende, ya tienes el problema delante. Para contarlo en un test, en vez de leerlo, la demo de la serie usa un interceptor (`DbCommandInterceptor`) que cuenta los comandos.

El código de las demos de toda la serie está en [ef-core-pills](https://github.com/MookieFumi/ef-core-pills): una base SQLite con 20.000 pedidos y un millón de envíos para poder ver cada problema con números reales. La siguiente píldora empieza por el más frecuente: el N+1.
