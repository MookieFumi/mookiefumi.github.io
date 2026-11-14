---
title: "EF Core tiene siete interceptores y tú solo usas uno"
subtitle: "Auditoría, SQL, conexiones, transacciones, materialización, LINQ e identidad: dónde se engancha cada uno y qué hace"
description: "Los siete tipos de interceptores de Entity Framework Core con un ejemplo ejecutado de cada uno: SaveChanges, comandos, conexiones, transacciones, materialización, expresiones LINQ y resolución de identidad."
date: 2026-12-30
topic: dotnet
published: false
---

Si has usado un interceptor de EF Core, casi seguro fue para rellenar `CreatedOn` y `UpdatedOn` antes de guardar. Es el ejemplo de todos los tutoriales. Pero EF Core tiene siete interfaces de interceptor, y cada una se engancha en un momento distinto: guardar, ejecutar un comando, abrir una conexión, cerrar una transacción, construir una entidad, traducir un LINQ o resolver una clave duplicada.

Los he probado todos con una entidad pequeña y SQLite. Los ejemplos de abajo son código que he ejecutado con EF Core 10; el proyecto completo está en [ef-core-pills](https://github.com/MookieFumi/ef-core-pills/tree/main/src/EfCoreInterceptors).

## Qué son y cómo se registran

Un interceptor te deja observar, modificar o cancelar una operación de EF Core. Eso lo distingue del logging, que solo observa. Se registran con `AddInterceptors` al configurar el contexto:

```csharp
var options = new DbContextOptionsBuilder<ShopContext>()
    .UseSqlite("Data Source=shop.db")
    .AddInterceptors(new AuditSaveChangesInterceptor(TimeProvider.System))
    .Options;
```

Con inyección de dependencias es lo mismo dentro de `AddDbContext`. Un detalle de la documentación que conviene tener presente: tres de los siete (materialización, expresiones de consulta e identidad) son singleton, es decir, EF Core usa una única instancia para todos los contextos. No guardes estado mutable en ellos.

| Interceptor | Se engancha en | Úsalo para |
|---|---|---|
| `ISaveChangesInterceptor` | Antes y después de `SaveChanges` | Auditoría, borrado lógico, outbox |
| `IDbCommandInterceptor` | Ejecución de comandos SQL | Consultas lentas, ver el SQL real |
| `IDbConnectionInterceptor` | Apertura de la conexión | Multiinquilino, tokens de acceso |
| `IDbTransactionInterceptor` | Commit y rollback | Registro alrededor de transacciones |
| `IMaterializationInterceptor` | Fila a entidad | Propiedades no mapeadas |
| `IQueryExpressionInterceptor` | LINQ antes de traducirse | Reescribir consultas |
| `IIdentityResolutionInterceptor` | Dos instancias con la misma clave | Fusionar en vez de lanzar excepción |

<figure class="diagram">
  <img class="diagram-light" width="1200" height="736" src="/img/diagrams/09-ef-core-interceptors-light.svg" alt="Infografía con el momento en que entra cada interceptor de EF Core. Al leer: IQueryExpressionInterceptor antes de traducir el LINQ, una vez por forma de consulta; IDbConnectionInterceptor al abrir la conexión; IDbCommandInterceptor antes y después de ejecutar el SQL; IMaterializationInterceptor al convertir cada fila en entidad. Al escribir: IIdentityResolutionInterceptor al rastrear una clave ya rastreada; ISaveChangesInterceptor antes y después de SaveChanges; IDbConnectionInterceptor al abrir la conexión; IDbTransactionInterceptor en inicio, commit y rollback explícito, con dos o más sentencias; IDbCommandInterceptor por cada INSERT, UPDATE o DELETE.">
  <img class="diagram-dark" width="1200" height="736" src="/img/diagrams/09-ef-core-interceptors-dark.svg" alt="Infografía con el momento en que entra cada interceptor de EF Core. Al leer: IQueryExpressionInterceptor antes de traducir el LINQ, una vez por forma de consulta; IDbConnectionInterceptor al abrir la conexión; IDbCommandInterceptor antes y después de ejecutar el SQL; IMaterializationInterceptor al convertir cada fila en entidad. Al escribir: IIdentityResolutionInterceptor al rastrear una clave ya rastreada; ISaveChangesInterceptor antes y después de SaveChanges; IDbConnectionInterceptor al abrir la conexión; IDbTransactionInterceptor en inicio, commit y rollback explícito, con dos o más sentencias; IDbCommandInterceptor por cada INSERT, UPDATE o DELETE.">
</figure>

## 1. ISaveChangesInterceptor: auditoría y borrado lógico

Es el que ya conoces, con un añadido útil: puede convertir un `Remove` en un borrado lógico cambiando el estado de la entrada antes de que EF genere el SQL.

```csharp
foreach (var entry in context.ChangeTracker.Entries())
{
    if (entry is { State: EntityState.Added, Entity: IAuditable added })
    {
        added.CreatedOn = now;
    }
    else if (entry is { State: EntityState.Deleted, Entity: ISoftDeletable deleted })
    {
        deleted.IsDeleted = true;
        entry.State = EntityState.Modified;
    }
}
```

Tras ejecutarlo: insertar rellena `CreatedOn`, modificar rellena `UpdatedOn`, y después de un `Remove` la consulta normal devuelve 0 productos mientras la tabla sigue teniendo 1 fila con `IsDeleted = true`. Con `HasQueryFilter(p => !p.IsDeleted)` el filtro de lectura sale gratis. Para ver la fila hay que usar `IgnoreQueryFilters()`.

Sobrescribe siempre las dos versiones, `SavingChanges` y `SavingChangesAsync`. Si solo implementas una, el código que llame a la otra se salta tu lógica sin avisar.

Es también el sitio habitual para el patrón outbox: en `SavingChanges` recoges los eventos de dominio de las entidades y los añades como filas de una tabla `Outbox` que se guardan en la misma transacción.

## 2. IDbCommandInterceptor: el SQL que sale de verdad

Aquí ves el comando justo antes o justo después de ejecutarse, con su duración. Mi versión imprime los comandos que superan un umbral (en la demo lo puse a cero para que salga todo):

```csharp
public override DbDataReader ReaderExecuted(DbCommand command, CommandExecutedEventData eventData, DbDataReader result)
{
    if (eventData.Duration >= threshold)
    {
        Console.WriteLine($"[slow query] {eventData.Duration.TotalMilliseconds:F0} ms");
        Console.WriteLine(command.CommandText);
    }

    return result;
}
```

Salida real de la demo:

```text
[slow query] 0 ms >= 0 ms
SELECT "p"."Id", "p"."CreatedOn", "p"."IsDeleted", "p"."Name", "p"."Price", "p"."UpdatedOn"
FROM "Products" AS "p"
WHERE NOT ("p"."IsDeleted") AND "p"."Price" < 100.0
```

Fíjate en el `WHERE NOT ("p"."IsDeleted")`: es el filtro global del punto anterior, que no escribiste en la consulta. Ver el SQL final sirve justo para eso.

Como el interceptor también recibe el comando antes de ejecutarlo (`ReaderExecuting`), puedes modificar `command.CommandText`, por ejemplo para añadir una sugerencia de consulta de tu base de datos. Esa parte no la he ejecutado: depende del motor y de una sintaxis que SQLite no tiene.

## 3. IDbConnectionInterceptor: una base de datos por inquilino

Se ejecuta justo antes de abrir la conexión, así que es el momento de decidir a qué base de datos conectarte. En la demo cada inquilino tiene su fichero SQLite:

```csharp
public override InterceptionResult ConnectionOpening(DbConnection connection, ConnectionEventData eventData, InterceptionResult result)
{
    connection.ConnectionString = $"Data Source={tenant.Current}.db";
    return result;
}
```

Probado: un producto guardado como `tenant-a` es visible para `tenant-a` (1) y no para `tenant-b` (0). Un matiz: la conexión se abre una vez por contexto y el contexto la reutiliza, así que el inquilino se decide al crear el `DbContext`. En una API web, con un contexto por petición, es lo que ya pasa.

El otro uso clásico es poner un token de acceso fresco antes de abrir la conexión. La documentación de EF Core lo ilustra con `SqlConnection.AccessToken` en `ConnectionOpeningAsync`. Esa variante no la he ejecutado, porque necesita Azure SQL. Y ten en cuenta que Microsoft.Data.SqlClient ya soporta autenticación con Entra ID desde la cadena de conexión: si te vale, es más simple.

## 4. IDbTransactionInterceptor: commit y rollback

Te avisa cuando se confirma o se deshace una transacción:

```text
[transaction] committed 6c28e020-2e50-40d2-98ab-62974524494d
SaveChanges failed (unique index)
[transaction] rolled back 23fd244c-832f-4b53-90fc-522a1dfef4df
```

Hay dos cosas que no esperaba y que la demo me enseñó:

- Un `SaveChanges` con una sola sentencia no abre transacción, así que no ves nada. Con dos o más sí.
- Cuando el `SaveChanges` falla por el índice único, el interceptor no registra ningún rollback. EF Core hace dispose de la transacción y la base de datos la deshace, pero no pasa por `TransactionRolledBack`. El único rollback del log de arriba es el de una transacción explícita que abrí al final con `BeginTransactionAsync`.

Si tu auditoría necesita saber que un guardado falló, usa `SaveChangesFailed` del `ISaveChangesInterceptor`, no este.

## 5. IMaterializationInterceptor: propiedades que no están en la tabla

Se ejecuta cuando EF Core convierte una fila en una entidad. Útil para rellenar propiedades no mapeadas:

```csharp
public object InitializedInstance(MaterializationInterceptionData materializationData, object instance)
{
    if (instance is Product product)
    {
        product.LoadedAt = clock.GetUtcNow().UtcDateTime;
    }

    return instance;
}
```

Con `LoadedAt` marcada como `[NotMapped]`, tras leer el producto vale `2026-11-14T11:43:50Z`, sin que exista ninguna columna. Es singleton, así que el reloj entra por constructor y el interceptor no guarda nada más.

## 6. IQueryExpressionInterceptor: cambiar el LINQ antes del SQL

Es el más potente y el más fácil de usar mal. Recibe el árbol de expresión de la consulta antes de traducirla. Mi ejemplo es una red de seguridad: si una consulta devuelve una lista sin `Take` ni `Skip`, le añade `Take(5)`.

```csharp
public Expression QueryCompilationStarting(Expression queryExpression, QueryExpressionEventData eventData)
{
    var type = queryExpression.Type;

    if (!type.IsGenericType || type.GetGenericTypeDefinition() != typeof(IQueryable<>))
    {
        return queryExpression;
    }

    // ...already limited? return as is. Otherwise wrap it in Queryable.Take(maxRows).
}
```

Un detalle que comprobé aparte: EF Core llama a este interceptor al compilar la consulta, no al ejecutarla. La misma consulta ejecutada tres veces, con contextos distintos, lo invocó una sola vez, porque la versión compilada queda en caché. Si metes en el árbol como constante un valor que cambia entre peticiones, como el usuario actual, se queda el de la primera.

Con 20 productos en la tabla:

```text
ToList() without Take: 5 rows (table has 20)
Take(3): 3 rows
Count(): 20
```

Cambiar en silencio lo que devuelve una consulta sorprende a quien la escribió: aquí pidió una lista y recibe 5 filas sin aviso. Resérvalo para reglas que tu equipo conozca y que un filtro global no pueda expresar.

## 7. IIdentityResolutionInterceptor: dos instancias, una clave

Pasa cuando el contexto ya rastrea un producto con `Id = 1` y llega otra instancia con el mismo `Id`, por ejemplo al adjuntar un objeto que vino de un formulario. Sin interceptor:

```text
InvalidOperationException: The instance of entity type 'Product' cannot be tracked because another instance with the same key value for {'Id'} is already being tracked.
```

Con el interceptor decides tú qué hacer. En la demo copio los valores de la nueva instancia sobre la que ya estaba rastreada:

```csharp
public void UpdateTrackedInstance(IdentityResolutionInterceptionData interceptionData, EntityEntry existingEntry, object newInstance)
{
    existingEntry.CurrentValues.SetValues(newInstance);
}
```

Resultado: el producto rastreado pasa a llamarse `Dock v2` con precio 120. Fusionar sobrescribe lo que había, y si dos usuarios editan a la vez, el último gana sin avisar. Piensa si eso es lo que quiere tu negocio antes de copiarlo.

## Cuándo no usar un interceptor

- Si solo quieres observar, `ILogger` y el logging de EF Core son más simples.
- Si el filtro se puede expresar como filtro global (`HasQueryFilter`), no escribas un interceptor de expresiones.
- Si la lógica es de negocio y depende de otros servicios, piénsalo dos veces: un interceptor se ejecuta dentro de `SaveChanges` y de la lectura, y una excepción ahí es difícil de depurar.
- No hagas trabajo costoso ni I/O dentro de ellos. Corren en el camino crítico de cada operación.

## Resumen

Los siete se registran con `AddInterceptors` y actúan en sitios distintos. Para auditoría y borrado lógico, `ISaveChangesInterceptor`. Para ver o medir el SQL, `IDbCommandInterceptor`. Si cambias de base de datos o de credenciales por inquilino, `IDbConnectionInterceptor`.

Lo que no he podido verificar: los ejemplos con SQL Server (token de acceso, sugerencias de consulta) y el comportamiento exacto en otros proveedores. La demo corre sobre SQLite.
