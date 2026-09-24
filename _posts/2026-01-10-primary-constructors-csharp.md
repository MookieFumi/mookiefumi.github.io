---
layout: post
title: Primary constructors en C#, de los records a cualquier clase (incluso en .NET 6)
subtitle: Qué son, de dónde vienen, qué hace el compilador por debajo y cómo usarlos hoy en proyectos que siguen en .NET 6
topic: desarrollo
published: true
---

Si has abierto código C# escrito en los últimos dos años seguramente te has encontrado con algo así:

```csharp
public class OrderService(IOrderRepository repository, ILogger<OrderService> logger)
{
    public async Task<Order?> GetAsync(int id)
    {
        logger.LogInformation("Buscando el pedido {OrderId}", id);
        return await repository.GetByIdAsync(id);
    }
}
```

Ni campos privados, ni constructor, ni asignaciones. Eso son los **primary constructors** (constructores primarios) y llegaron a las clases y structs con **C# 12**. En este artículo quiero contar de dónde vienen, qué hace realmente el compilador con ellos, qué trampas tienen y, sobre todo, cómo podemos usarlos en proyectos que todavía siguen en **.NET 6**, que en mi día a día es más habitual de lo que me gustaría.

## Un poco de historia

Los primary constructors no son una idea nueva, han tardado casi diez años en llegar tal y como los conocemos:

| Año | Versión | Qué pasó |
| --- | --- | --- |
| 2014 | C# 6 (preview) | Aparecen en las primeras previews de C# 6 para clases y structs. Se retiran antes de la versión final porque el diseño no terminaba de encajar. |
| 2020 | C# 9 / .NET 5 | Llegan los **records** y con ellos la sintaxis posicional: `record Person(string Name, int Age);`. Es un primary constructor, pero solo para records. |
| 2021 | C# 10 / .NET 6 | Aparecen los `record struct`, también con sintaxis posicional. |
| 2023 | C# 12 / .NET 8 | Los primary constructors llegan a **cualquier clase y struct**. |

Es importante tener esta línea temporal en la cabeza porque explica una de las confusiones más habituales: **un primary constructor en un record no se comporta igual que en una clase**. Lo vemos más adelante.

## ¿Qué es un primary constructor?

Es una lista de parámetros que se declara directamente junto al nombre del tipo. Esos parámetros están disponibles **en todo el cuerpo de la clase**: en métodos, propiedades, inicializadores de campos...

Veamos el típico servicio con inyección de dependencias, antes y después.

```csharp
// Antes (C# 11 o anterior)
public class OrderService
{
    private readonly IOrderRepository _repository;
    private readonly ILogger<OrderService> _logger;

    public OrderService(IOrderRepository repository, ILogger<OrderService> logger)
    {
        _repository = repository;
        _logger = logger;
    }

    public async Task<Order?> GetAsync(int id)
    {
        _logger.LogInformation("Buscando el pedido {OrderId}", id);
        return await _repository.GetByIdAsync(id);
    }
}
```

```csharp
// Ahora (C# 12)
public class OrderService(IOrderRepository repository, ILogger<OrderService> logger)
{
    public async Task<Order?> GetAsync(int id)
    {
        logger.LogInformation("Buscando el pedido {OrderId}", id);
        return await repository.GetByIdAsync(id);
    }
}
```

Nueve líneas menos en una clase con dos dependencias. En servicios con cuatro o cinco dependencias, que los hay, la diferencia se nota muchísimo al abrir el fichero.

## Lo que hace el compilador por debajo

Aquí está la parte que más me interesa, porque entenderla evita la mayoría de sorpresas. **Los parámetros de un primary constructor en una clase no son propiedades ni campos**, son parámetros. El compilador decide qué hacer con ellos según cómo los uses:

* **Si solo los usas para inicializar un campo o una propiedad**, se comportan como un parámetro normal de constructor. No se guarda nada extra.
* **Si los usas dentro de un método o propiedad**, el compilador los "captura": genera un campo privado oculto para guardar el valor.

Para el `OrderService` de antes, el compilador genera algo parecido a esto:

```csharp
public class OrderService
{
    // Nombres que no puedes escribir en C#, por eso no colisionan con los tuyos
    private IOrderRepository <repository>P;
    private ILogger<OrderService> <logger>P;

    public OrderService(IOrderRepository repository, ILogger<OrderService> logger)
    {
        <repository>P = repository;
        <logger>P = logger;
        base();
    }

    public async Task<Order?> GetAsync(int id)
    {
        <logger>P.LogInformation("Buscando el pedido {OrderId}", id);
        return await <repository>P.GetByIdAsync(id);
    }
}
```

Fíjate en un detalle: **el campo generado no es `readonly`**. Esto tiene consecuencias:

```csharp
public class Counter(int start)
{
    public int Next() => start++; // Compila: el parámetro se puede modificar
}
```

Y además los parámetros **no son accesibles con `this.`** ni desde clases derivadas. Solo existen dentro del cuerpo del tipo que los declara.

## Records y clases no son lo mismo

Esta es la tabla que me hubiese gustado tener la primera vez que los usé:

| | `record Person(string Name)` | `class Person(string Name)` |
| --- | --- | --- |
| Genera una propiedad pública `Name` | Sí (`init` en `record class`) | **No** |
| Genera `Deconstruct`, `Equals`, `ToString`... | Sí | No |
| Se puede leer desde fuera (`person.Name`) | Sí | **No** |
| El valor se puede modificar desde dentro | No (es una propiedad `init`) | **Sí** |

Si vienes de records y escribes `class Person(string Name)` esperando tener `person.Name`, no compila. Y la convención cambia: en records los parámetros van en `PascalCase` porque se convierten en propiedades; en clases lo habitual es `camelCase`, porque son parámetros.

Si quieres exponer el valor en una clase, lo haces de forma explícita:

```csharp
public class Person(string name)
{
    public string Name { get; } = name;
}
```

## Casos de uso donde brillan

### Inyección de dependencias en ASP.NET Core

Es el caso más claro. Servicios, handlers, controladores... todo lo que recibe dependencias y las usa tal cual.

```csharp
[ApiController]
[Route("api/[controller]")]
public class OrdersController(IOrderService orderService) : ControllerBase
{
    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var order = await orderService.GetAsync(id);
        return order is null ? NotFound() : Ok(order);
    }
}
```

### ViewModels en .NET MAUI con CommunityToolkit.Mvvm

Si leíste el artículo de [.NET MAUI MVVM con Community Toolkit](/2024-06-11-maui-mvvm-community-toolkit), el ViewModel de lanzamientos de SpaceX queda así de limpio combinando ambas cosas:

```csharp
public partial class LaunchesViewModel(
    ISpaceXService spaceXService,
    INavigationService navigationService) : ObservableObject
{
    [ObservableProperty]
    private ObservableCollection<GetLaunchesResponse> _launchesResponse = [];

    [RelayCommand]
    private async Task LoadAsync()
    {
        var launches = await spaceXService.GetLaunchesAsync();
        LaunchesResponse = new ObservableCollection<GetLaunchesResponse>(launches);
    }

    [RelayCommand]
    private Task GoToDetail(Launch launch) =>
        navigationService.NavigateToAsync(nameof(LaunchDetailView), launch);
}
```

Y en los tests se instancia igual que siempre, pasando los mocks por constructor:

```csharp
var viewModel = new LaunchesViewModel(spaceXServiceMock.Object, navigationServiceMock.Object);
```

### Herencia

Una clase con primary constructor puede pasar sus parámetros a la clase base directamente en la declaración:

```csharp
public abstract class RepositoryBase(AppDbContext context)
{
    protected AppDbContext Context { get; } = context;
}

public class OrderRepository(AppDbContext context) : RepositoryBase(context), IOrderRepository
{
    public Task<Order?> GetByIdAsync(int id) =>
        Context.Orders.FirstOrDefaultAsync(o => o.Id == id);
}
```

## Validación y `readonly`

Un primary constructor no tiene cuerpo, así que no hay dónde poner un `if (repository is null) throw ...`. La solución es usar un inicializador de campo, que además te da un campo `readonly`:

```csharp
public class OrderService(IOrderRepository repository, ILogger<OrderService> logger)
{
    private readonly IOrderRepository _repository =
        repository ?? throw new ArgumentNullException(nameof(repository));

    private readonly ILogger<OrderService> _logger = logger;

    public Task<Order?> GetAsync(int id) => _repository.GetByIdAsync(id);
}
```

Como `repository` y `logger` solo se usan en los inicializadores, el compilador **no** los captura. Tienes la sintaxis corta en la declaración y campos `readonly` de toda la vida. Es el patrón que uso cuando el equipo quiere garantizar que nadie reasigna una dependencia por error.

Eso sí, a partir de aquí usa siempre `_repository` y nunca `repository` dentro de los métodos, porque si no el compilador guardaría el valor dos veces y te avisará (lo vemos en el siguiente apartado).

> A día de hoy (C# 14) no existe una forma de marcar un parámetro de primary constructor como `readonly`. Es un tema que se ha discutido mucho en el repositorio del lenguaje ([dotnet/csharplang](https://github.com/dotnet/csharplang)), así que no descarto que llegue.

## Las advertencias que conviene conocer

El compilador tiene tres avisos específicos que te van a salvar de más de un bug:

**CS9113: el parámetro no se lee nunca.**

```csharp
public class OrderService(IOrderRepository repository, IClock clock) // CS9113 en clock
{
    public Task<Order?> GetAsync(int id) => repository.GetByIdAsync(id);
}
```

**CS9124: el parámetro se captura y además inicializa un campo o propiedad.** Tienes el mismo valor guardado dos veces y, si uno cambia, el otro no.

```csharp
public class OrderService(IOrderRepository repository)
{
    private readonly IOrderRepository _repository = repository;

    // CS9124: aquí se usa "repository" en lugar de "_repository"
    public Task<Order?> GetAsync(int id) => repository.GetByIdAsync(id);
}
```

**CS9107: el parámetro se captura y además se pasa a la clase base.** La base probablemente también lo guarda, así que acabas con dos copias.

```csharp
public class OrderRepository(AppDbContext context) : RepositoryBase(context)
{
    // CS9107: usa la propiedad Context de la base en lugar del parámetro
    public Task<int> CountAsync() => context.Orders.CountAsync();
}
```

Mi recomendación es subir estos tres avisos a error en el `.editorconfig`:

```ini
[*.cs]
dotnet_diagnostic.CS9107.severity = error
dotnet_diagnostic.CS9113.severity = error
dotnet_diagnostic.CS9124.severity = error
```

## Otros constructores

Puedes tener más constructores, pero **todos tienen que acabar llamando al primary constructor** con `this(...)`:

```csharp
public class RetryPolicy(int maxAttempts, TimeSpan delay)
{
    public RetryPolicy() : this(3, TimeSpan.FromSeconds(1))
    {
    }

    public int MaxAttempts => maxAttempts;
    public TimeSpan Delay => delay;
}
```

Si no lo haces obtendrás el error CS8862.

## Cuándo no los usaría

No todo tiene que pasar a primary constructor. Estos son los casos en los que sigo escribiendo el constructor de siempre:

* **Páginas XAML en .NET MAUI (o WPF).** Necesitan llamar a `InitializeComponent()` en el constructor y un primary constructor no tiene cuerpo.

  ```csharp
  public partial class LaunchesPage : ContentPage
  {
      public LaunchesPage(LaunchesViewModel viewModel)
      {
          InitializeComponent();
          BindingContext = viewModel;
      }
  }
  ```

* **Constructores con lógica**: suscripciones a eventos, cálculos, varias validaciones encadenadas...
* **Modelos de dominio donde la inmutabilidad importa.** Si el tipo es un valor, casi siempre encaja mejor un `record`.
* **Clases con muchísimos parámetros.** El primary constructor no arregla el problema de fondo; solo lo esconde en una línea larga.

## Usarlos en proyectos .NET 6

Y aquí viene la parte práctica. Tengo varios proyectos que siguen en **.NET 6** (sí, sé que [dejó de tener soporte en noviembre de 2024](https://dotnet.microsoft.com/es-es/platform/support/policy/dotnet-core)) y que no se pueden migrar de un día para otro. ¿Puedo usar primary constructors ahí? La respuesta corta es **sí**.

### Por qué funciona

Cada versión de .NET trae una versión de C# por defecto: .NET 6 usa **C# 10**. Pero la versión del lenguaje la decide el **compilador**, que viene con el **SDK**, no con el runtime.

Un primary constructor es **azúcar sintáctico**: el compilador lo convierte en un constructor y unos campos normales. No necesita ningún tipo nuevo del runtime. Así que si compilas con un SDK moderno y le dices que use C# 12, el resultado es un ensamblado que corre perfectamente en .NET 6.

### Paso 1: instalar un SDK moderno

Necesitas el **SDK de .NET 8 o posterior** en tu máquina y en el servidor de integración continua. El SDK puede compilar proyectos que apuntan a `net6.0` sin problema.

```bash
dotnet --list-sdks
```

### Paso 2: fijar la versión del SDK con `global.json`

Para que todo el equipo y la CI compilen con el mismo SDK, añade un `global.json` en la raíz de la solución:

```json
{
  "sdk": {
    "version": "8.0.100",
    "rollForward": "latestFeature"
  }
}
```

### Paso 3: subir `LangVersion`

En el `.csproj`, sin tocar el `TargetFramework`:

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net6.0</TargetFramework>
    <LangVersion>12</LangVersion>
    <Nullable>enable</Nullable>
  </PropertyGroup>

</Project>
```

Si tienes muchos proyectos, mejor hacerlo una sola vez en un `Directory.Build.props` en la raíz de la solución:

```xml
<Project>
  <PropertyGroup>
    <LangVersion>12</LangVersion>
  </PropertyGroup>
</Project>
```

Te recomiendo poner una versión concreta (`12`) y no `latest`. Con `latest` la versión del lenguaje cambia según el SDK que tenga instalado cada uno, y es muy fácil que algo compile en tu máquina y falle en la CI.

### Paso 4: compilar y revisar los avisos

Al compilar verás el aviso **NETSDK1138** indicando que `net6.0` ya no tiene soporte. Es informativo; no bloquea la compilación. Todos los ejemplos de código de las secciones anteriores sobre servicios, validación, avisos y constructores los he compilado así, en un proyecto `net6.0` con el SDK de .NET 8.

Y a partir de aquí ya puedes escribir:

```csharp
// Proyecto net6.0 compilado con el SDK de .NET 8 y LangVersion 12
public class InvoiceService(IInvoiceRepository repository, ILogger<InvoiceService> logger)
{
    public async Task<Invoice?> GetAsync(Guid id)
    {
        logger.LogDebug("Recuperando factura {InvoiceId}", id);
        return await repository.GetAsync(id);
    }
}
```

### ¿Qué otras novedades de C# funcionan en .NET 6?

La regla es sencilla: **lo que es solo sintaxis funciona; lo que necesita tipos o capacidades nuevas del runtime, no**.

| Característica | Versión de C# | En .NET 6 |
| --- | --- | --- |
| Primary constructors en clases y structs | 12 | Funciona |
| Alias de cualquier tipo (`using Point = (int X, int Y);`) | 12 | Funciona |
| Parámetros opcionales en lambdas | 12 | Funciona |
| Raw string literals (`"""..."""`) | 11 | Funciona |
| Miembros `required` | 11 | Necesita declarar a mano unos atributos (`RequiredMemberAttribute`, `CompilerFeatureRequiredAttribute`) o usar un paquete como [PolySharp](https://github.com/Sergio0694/PolySharp) |
| `[InlineArray]` | 12 | No funciona, necesita el runtime de .NET 8 |
| Campos `ref` en `ref struct` | 11 | No funciona, necesita el runtime de .NET 7 o posterior |

### Lo que dice Microsoft

Microsoft desaconseja usar una versión del lenguaje más nueva que la predeterminada de tu framework, porque puede provocar errores difíciles de diagnosticar. Con primary constructors no he tenido ningún problema, ya que no dependen de nada del runtime, pero conviene saberlo y tener buenos tests.

Para mí esto es una **herramienta de transición**: te permite ir escribiendo código moderno mientras preparas la migración a .NET 8 o .NET 10 (la LTS actual). Cuando migres, ese código no tendrás que tocarlo.

## Convertir código existente

No hace falta hacerlo a mano. Visual Studio ofrece la acción rápida **"Usar constructor principal"** (en inglés, *Use primary constructor*) sobre cualquier constructor que solo asigna parámetros a campos o propiedades, y Rider tiene una equivalente. El analizador que la sugiere es el **IDE0290**.

Si quieres que el IDE lo sugiera siempre (o que no lo haga nunca), se configura en el `.editorconfig`:

```ini
[*.cs]
# true: sugiere usar primary constructors; false: no los sugiere
csharp_style_prefer_primary_constructors = true:suggestion
```

Mi consejo es no hacer una conversión masiva en un solo PR. Es un cambio que toca muchos ficheros sin aportar funcionalidad y complica las revisiones. Mejor aplicarlo en las clases que vayas tocando.

## Resumen

* Los primary constructors llegaron a los records en **C# 9** y a cualquier clase o struct en **C# 12**.
* En clases, los parámetros **no son propiedades**: si se usan en métodos, el compilador los guarda en campos ocultos y **mutables**.
* Si necesitas `readonly` o validación, asígnalos a un campo en el inicializador y usa solo el campo.
* Sube a error los avisos **CS9107**, **CS9113** y **CS9124**.
* Evítalos en páginas XAML y en constructores con lógica.
* En **.NET 6** puedes usarlos compilando con el SDK de .NET 8 o posterior y `LangVersion` 12, fijando la versión del SDK con `global.json`.

## Enlaces de interés

| Info | Enlace |
| --- | --- |
| Primary constructors en Microsoft Learn | https://learn.microsoft.com/es-es/dotnet/csharp/whats-new/tutorials/primary-constructors |
| Versiones del lenguaje C# y frameworks | https://learn.microsoft.com/es-es/dotnet/csharp/language-reference/configure-language-version |
| Novedades de C# 12 | https://learn.microsoft.com/es-es/dotnet/csharp/whats-new/csharp-12 |
| Política de soporte de .NET | https://dotnet.microsoft.com/es-es/platform/support/policy/dotnet-core |
