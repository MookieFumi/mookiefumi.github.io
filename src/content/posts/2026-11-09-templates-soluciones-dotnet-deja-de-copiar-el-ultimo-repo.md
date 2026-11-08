---
title: "Templates de soluciones en .NET. Deja de copiar el último repo."
subtitle: Un comando que genera la solución con las normas de tu empresa ya puestas, y un CI que comprueba que la plantilla sigue compilando
description: "Cómo crear una plantilla de dotnet new para una Minimal API en .NET 10: template.json, parámetros opcionales, empaquetado en NuGet, pruebas en GitHub Actions y publicación en GitHub Packages."
date: 2026-11-09
topic: desarrollo
series: gobernanza-dotnet
published: true
---

Hay un repo en tu empresa que «está bien hecho». Cuando alguien necesita un proyecto nuevo, lo clona, borra lo que no hace falta y renombra lo que se acuerda de renombrar. Seis meses después, el proyecto nuevo todavía tiene el nombre del anterior en el `README` y una versión de un paquete que el original ya había actualizado.

Copiar el último repo hereda sus rarezas junto con sus virtudes. Y las normas de las que hablé en esta serie ([`Directory.Build.props`](/2026-09-12-directory-build-props-contrato-calidad), [versiones centralizadas](/2026-09-13-central-package-management-nuget), [calidad del lenguaje](/2026-09-14-estandares-lenguaje-calidad-dotnet), [CI](/2026-09-16-hacer-cumplir-normas-dotnet-github-actions)) no sirven de mucho si cada proyecto nuevo tiene que acordarse de copiarlas.

`dotnet new` resuelve esto con plantillas propias. Esta es la mía: [`dotnet-api-template`](https://github.com/MookieFumi/dotnet-api-template), una solución con una Minimal API, un test y los ficheros de gobernanza. Las partes que no necesita todo el mundo (un AppHost de Aspire, un worker) son parámetros opcionales.

```bash
dotnet new launchpad-api -n Orders             # Orders.Api + tests
dotnet new launchpad-api -n Orders --aspire    # + AppHost and ServiceDefaults
dotnet new launchpad-api -n Orders --worker    # + background worker
```

## Qué lleva dentro (y qué no)

Como referencia usé [entry-hub](https://github.com/MookieFumi/entry-hub), el repo de las demos de esta serie. De ahí salen la estructura de `src/`, los ficheros de gobernanza, la API organizada por funcionalidades y el CI. Lo que se queda fuera es todo lo que solo tiene sentido en esas demos: Kubernetes, el gateway, el dominio de salas, los tests que arrancan el sistema entero.

La plantilla es un ejemplo mínimo a propósito. El único *slice* es `GET /api/v1/greetings/{name}`: un endpoint, un handler y una respuesta, sin base de datos. Compila y pasa sus tests desde el primer minuto, y cada equipo lo sustituye por su primera funcionalidad real.

Dos cosas de entry-hub las dejé fuera a propósito. Los `packages.lock.json` van comitados allí, y una plantilla no puede traerlos, porque dependen de los paquetes que resuelva cada proyecto. Y los hooks de Husky necesitan un manifiesto de herramientas y un repo git ya inicializado. Cada equipo decide si los añade.

## Los ficheros, uno por uno

El repo tiene dos mitades: lo que empaqueta la plantilla y lo que genera.

```text
dotnet-api-template/
├── Launchpad.Api.Template.csproj       # packs the template into a NuGet package
├── .github/workflows/ci.yml            # tests the template
├── .github/workflows/release.yml       # publishes the package
└── templates/api/
    ├── .template.config/
    │   ├── template.json
    │   └── dotnetcli.host.json
    ├── .github/                         # CI, PR title check, Dependabot, CODEOWNERS
    └── src/
        ├── Directory.Build.props
        ├── Directory.Packages.props
        ├── .editorconfig
        ├── global.json
        ├── nuget.config
        ├── Launchpad.slnx
        ├── Launchpad.Api/
        └── tests/Launchpad.Api.Tests/
```

### `template.json`

Es el único fichero obligatorio de una plantilla. Según [la documentación de Microsoft](https://learn.microsoft.com/en-us/dotnet/core/tools/custom-templates), `identity`, `name` y `shortName` son obligatorios, y `sourceName` es la cadena que el motor sustituye por el nombre que pasas con `-n`.

```json
{
  "identity": "Launchpad.Api.Template",
  "name": "Launchpad .NET API",
  "shortName": "launchpad-api",
  "tags": { "language": "C#", "type": "solution" },
  "sourceName": "Launchpad",
  "preferNameDirectory": true,
  "primaryOutputs": [ { "path": "src/Launchpad.slnx" } ]
}
```

Con `-n Orders`, `Launchpad.Api` pasa a `Orders.Api`, tanto en el nombre de la carpeta como en los `namespace` y en las referencias del `.csproj`. Por eso `sourceName` debe ser una palabra que no aparezca en el código por casualidad. `preferNameDirectory` crea una carpeta con el nombre del proyecto en lugar de volcar los ficheros donde estés.

### `dotnetcli.host.json`

Define cómo se llaman las opciones en la línea de comandos. Yo solo fijo los nombres largos de los dos parámetros, `--aspire` y `--worker`.

### El `.csproj` que empaqueta

No compila nada: sirve para que `dotnet pack` meta la carpeta `templates/` dentro de un `.nupkg`. Estas son las propiedades que importan:

```xml
<PackageType>Template</PackageType>
<IncludeBuildOutput>false</IncludeBuildOutput>
<ContentTargetFolders>content</ContentTargetFolders>
<EnableDefaultItems>false</EnableDefaultItems>
<NoDefaultExcludes>true</NoDefaultExcludes>
```

`PackageType` hace que el paquete aparezca en `dotnet new search`. `NoDefaultExcludes` es la que olvidé al principio: por defecto NuGet ignora los ficheros que empiezan por punto, y la plantilla perdía `.editorconfig` y `.gitignore`. Me lo avisó `dotnet pack` con un `NU5119` por cada fichero. La [documentación de Microsoft](https://learn.microsoft.com/en-us/dotnet/core/tutorials/cli-templates-create-template-package) explica que esa propiedad existe precisamente para eso.

### Lo que genera

- `Directory.Build.props`: `net10.0`, nullable, análisis `latest-recommended` y `TreatWarningsAsErrors` solo cuando corre `GITHUB_ACTIONS`. En local avisa; en CI rompe.
- `Directory.Packages.props`: una versión por paquete para toda la solución. Lleva el pin de `MessagePack` por una vulnerabilidad que arrastra Aspire, con un comentario que dice cuándo quitarlo.
- `.editorconfig` en `src/` y uno pequeño en `tests/` que permite nombres de test con guiones bajos.
- `global.json` con el SDK fijado y `nuget.config` con `packageSourceMapping`, listo para añadir el feed interno.
- `.github/`: el CI, la comprobación del título del PR con Conventional Commits, Dependabot y un `CODEOWNERS` con un equipo de ejemplo que hay que cambiar.

## Parámetros: qué cambia cada uno

Cada parámetro es un `symbol` de tipo `bool` que vale `false` si no lo pasas:

```json
"symbols": {
  "aspire": { "type": "parameter", "datatype": "bool", "defaultValue": "false" },
  "worker": { "type": "parameter", "datatype": "bool", "defaultValue": "false" }
},
"sources": [{
  "modifiers": [
    { "condition": "(!aspire)", "exclude": [ "src/Launchpad.AppHost/**", "src/Launchpad.ServiceDefaults/**" ] },
    { "condition": "(!worker)", "exclude": [ "src/Launchpad.Worker/**" ] }
  ]
}]
```

Sin `--aspire`, las carpetas del AppHost y de ServiceDefaults no se generan. Los ficheros que sí se generan, pero cambian según el parámetro, usan [formatos de comentario condicional](https://github.com/dotnet/templating/wiki/Conditional-processing-and-comment-syntax). En C# es `//#if (aspire)` y en XML (`.csproj`, `.slnx`) es `<!--#if (aspire) -->`:

```csharp
var builder = WebApplication.CreateBuilder(args);

//#if (aspire)
builder.AddServiceDefaults();

//#endif
builder.Services.AddProblemDetails();
```

Con dos parámetros hay cuatro soluciones posibles (ninguno, `--aspire`, `--worker` y ambos), y compilo las cuatro. Cada `bool` nuevo duplica esa cifra y alguien tiene que probar todas las combinaciones. Por eso solo hay dos, y cualquier parámetro más tiene que justificar ese coste.

## CI: probar la plantilla antes de repartirla

Una plantilla es código que nadie compila hasta que alguien la usa. Cuando por fin la usa, el que se encuentra el error es un compañero con un proyecto recién creado. El CI de este repo hace lo que haría ese compañero:

```yaml
strategy:
  fail-fast: false
  matrix:
    options: ["", "--aspire", "--worker", "--aspire --worker"]

steps:
  - run: dotnet pack -c Release -o "$RUNNER_TEMP/packages"
  - run: dotnet new install "$RUNNER_TEMP"/packages/Launchpad.Api.Template.*.nupkg
  - run: dotnet new launchpad-api -n Orders -o "$RUNNER_TEMP/orders" ${{ matrix.options }}
  - run: |
      dotnet build -c Release
      dotnet test --no-build -c Release
    working-directory: ${{ runner.temp }}/orders/src
```

Empaqueta, instala el paquete (no la carpeta, para probar también el empaquetado), genera y compila. Como en GitHub Actions `GITHUB_ACTIONS` es `true`, las advertencias son errores. Y eso destapó tres fallos en mi primera versión:

1. Los tests no compilaban. Usé `TestContext.Current.CancellationToken`, que existe en xUnit v3, y la plantilla trae la 2.9.3.
2. El worker no pasaba el análisis. `logger.LogInformation(...)` dispara `CA1848` y `CA1873`, y con advertencias como errores rompe. Lo pasé a `[LoggerMessage]`.
3. El AppHost no restauraba. Arrastraba `MessagePack 2.5.302`, que tiene una vulnerabilidad conocida (`GHSA-qhrr-8q5h-9q3h`) y el `NU1902` se convierte en error. De ahí el pin que mencioné antes.

Primero los ejecuté en local con `GITHUB_ACTIONS=true`, las cuatro combinaciones, y compilan y pasan sus dos tests. Después el workflow corrió en GitHub con la misma matriz y salió en verde.

## Publicar en GitHub Packages

El workflow `release.yml` se dispara con un tag `v*`, empaqueta con esa versión y hace `dotnet nuget push` al feed de tu organización:

```yaml
- run: dotnet pack -c Release -o packages -p:PackageVersion="${GITHUB_REF_NAME#v}"
- run: >
    dotnet nuget push "packages/*.nupkg"
    --source "https://nuget.pkg.github.com/${{ github.repository_owner }}/index.json"
    --api-key "${{ secrets.GITHUB_TOKEN }}"
```

Un tag `v1.2.0` publica la `1.2.0`. Lo probé con el tag `v1.0.0`, el job terminó en verde y el paquete apareció en GitHub Packages. El `GITHUB_TOKEN` basta para publicar paquetes asociados al repo del workflow, según [la documentación de GitHub](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-nuget-registry).

¿Cuesta dinero? Para paquetes públicos no. Para privados hay una cuota mensual según el plan: 500 MB de almacenamiento y 1 GB de transferencia en Free, 2 GB y 10 GB en Team, y 50 GB y 100 GB en Enterprise Cloud, según [la página de facturación](https://docs.github.com/en/billing/concepts/product-billing/github-packages) (consulta las cifras vigentes, que cambian). Un paquete de plantilla pesa unos kilobytes, así que la cuota no suele ser el problema.

Lo que sí condiciona el día a día es la autenticación: GitHub pide un token para instalar paquetes, también los públicos. Cada desarrollador necesita un token personal con `read:packages` y registrar el feed una vez.

## Instalar y actualizar

```bash
dotnet nuget add source --username YOUR_USER --password YOUR_TOKEN \
  --store-password-in-clear-text --name github \
  "https://nuget.pkg.github.com/YOUR_ORG/index.json"

dotnet new install Launchpad.Api.Template
dotnet new launchpad-api -n Orders
```

`--store-password-in-clear-text` es la opción que usa la documentación de GitHub: el token queda guardado en texto plano en tu configuración de NuGet, así que usa uno con el permiso mínimo. Para actualizar, `dotnet new update --check-only` te dice si hay versión nueva y `dotnet new update` la instala. Antes de aceptar cualquier plantilla, recuerda el aviso de Microsoft: pueden ejecutar tareas MSBuild durante la creación, así que instala solo de fuentes que conozcas.

Si usas el feed de GitHub junto a nuget.org, configura el *package source mapping* del `nuget.config` (ya viene en la plantilla). GitHub documenta que, sin él, un fallo de autenticación en su feed puede bloquear la restauración de paquetes públicos con errores 403 intermitentes.

## El límite: una plantilla no actualiza lo que ya generó

Una plantilla se aplica una sola vez. Si cambias el `Directory.Build.props` de la plantilla en marzo, los proyectos que se crearon en enero no se enteran. La plantilla consigue que los proyectos nuevos empiecen bien, y eso es la mitad del problema.

La otra mitad no la resuelve `dotnet new`. Para que las reglas evolucionen en los proyectos existentes necesitas algo que se ejecute en ellos: Dependabot para las versiones de los paquetes, y una acción de gobernanza compartida en el CI, como la del [post de GitHub Actions](/2026-09-16-hacer-cumplir-normas-dotnet-github-actions), que falle cuando un repo se salga de la norma.

El reparto queda así: la plantilla evita que cada proyecto nazca torcido y las comprobaciones en CI evitan que se tuerza con el tiempo.
