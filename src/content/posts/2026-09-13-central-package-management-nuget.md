---
title: "Central Package Management: una única fuente de verdad para tus paquetes NuGet"
subtitle: Directory.Packages.props, excepciones controladas, transitive pinning y cadena de suministro
date: 2026-09-13
topic: desarrollo
published: true
---

Con Central Package Management (CPM), las versiones de todos los paquetes NuGet de una solución viven en un único fichero: `Directory.Packages.props`. Los `.csproj` dicen qué paquetes usan y ese fichero decide en qué versión. Este es el segundo post de la serie sobre gobernanza de soluciones .NET; en el [primero](/2026-09-12-directory-build-props-contrato-calidad) vimos `Directory.Build.props`.

Aquí repaso cómo funciona, cómo gestionar las excepciones y cómo apoyarte en él para proteger la cadena de suministro. Al final explico por qué, para un equipo, CPM tiene que ver sobre todo con cómo se toman las decisiones técnicas.

## El problema: versiones dispersas en cada proyecto

Sin CPM, cada `.csproj` declara su propia versión de cada paquete:

```xml
<!-- Payments.Api.csproj -->
<PackageReference Include="Microsoft.EntityFrameworkCore" Version="10.0.0" />

<!-- Payments.Worker.csproj -->
<PackageReference Include="Microsoft.EntityFrameworkCore" Version="9.0.4" />
```

En una solución con decenas de proyectos pasa siempre lo mismo:

- Conviven versiones distintas del mismo paquete y los conflictos cuestan de diagnosticar.
- Aparecen avisos de downgrade (`NU1605`) cuando un proyecto referencia a otro que usa una versión más alta.
- Un parche de seguridad es lento: hay que encontrar y tocar cada `.csproj` que usa el paquete vulnerable.
- Los PRs de actualización son enormes y nadie los revisa con detalle.

## Fundamentos: Directory.Packages.props

CPM se activa con un fichero `Directory.Packages.props` en la raíz del repositorio. Se puede crear con la plantilla del SDK:

```bash
dotnet new packagesprops
```

El fichero activa la gestión centralizada y declara una versión por paquete:

```xml
<!-- Directory.Packages.props -->
<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>

  <ItemGroup Label="Data">
    <PackageVersion Include="Microsoft.EntityFrameworkCore" Version="10.0.0" />
    <PackageVersion Include="Microsoft.EntityFrameworkCore.SqlServer" Version="10.0.0" />
  </ItemGroup>

  <ItemGroup Label="Testing">
    <PackageVersion Include="xunit" Version="2.9.3" />
    <PackageVersion Include="Moq" Version="4.20.72" />
  </ItemGroup>
</Project>
```

Los `.csproj` siguen usando `PackageReference`, pero sin versión:

```xml
<ItemGroup>
  <PackageReference Include="Microsoft.EntityFrameworkCore.SqlServer" />
</ItemGroup>
```

Tres reglas que conviene saber desde el principio:

- `PackageVersion` no añade el paquete a ningún proyecto. Solo fija su versión, y cada proyecto sigue decidiendo qué usa con `PackageReference`.
- Un `PackageReference` con `Version` da el error `NU1008`: con CPM activo, la versión solo puede venir del fichero central.
- Un `PackageReference` sin su `PackageVersion` da el error `NU1010`: todo paquete que se use tiene que estar declarado en el fichero central.

Igual que con `Directory.Build.props`, MSBuild usa el `Directory.Packages.props` más cercano subiendo por las carpetas. Uno solo en la raíz es lo habitual y lo más fácil de mantener.

Las versiones de los ejemplos son orientativas. Usa siempre las que tu equipo haya validado.

## Excepciones controladas con VersionOverride

A veces un proyecto necesita otra versión: una librería legacy que todavía no soporta la última, o un microservicio que va por delante probando una release. Para eso existe `VersionOverride`:

```xml
<!-- Legacy.Reports.csproj -->
<ItemGroup>
  <!-- TODO(ARCH-1234): eliminar al migrar el motor de informes -->
  <PackageReference Include="Microsoft.EntityFrameworkCore" VersionOverride="9.0.4" />
</ItemGroup>
```

Frente al modelo antiguo, la excepción es explícita y fácil de encontrar: buscando `VersionOverride` en el repositorio ves todas las desviaciones del estándar.

Dos recomendaciones:

- Acompaña cada `VersionOverride` de un comentario con el motivo y un ticket, para que la excepción tenga fecha de caducidad.
- Si tu equipo no quiere excepciones, desactívalas en el fichero central con `<CentralPackageVersionOverrideEnabled>false</CentralPackageVersionOverrideEnabled>`.

## GlobalPackageReference para analizadores

Hay paquetes que deben estar en todos los proyectos: analizadores de código, SourceLink de proveedores que no vienen en el SDK o herramientas de build. En lugar de añadirlos uno a uno, se declaran una vez con `GlobalPackageReference`:

```xml
<!-- Directory.Packages.props -->
<ItemGroup Label="Analyzers">
  <GlobalPackageReference Include="SonarAnalyzer.CSharp" Version="10.15.0.120848" />
  <GlobalPackageReference Include="Meziantou.Analyzer" Version="2.0.220" />
</ItemGroup>
```

NuGet los añade a cada proyecto como dependencias privadas (`PrivateAssets="All"`), así que no se propagan a quien consuma tus librerías. Por eso `GlobalPackageReference` sirve para dependencias de desarrollo y nunca para paquetes que tu código necesita en tiempo de ejecución.

Este es el sitio correcto para lo que en la parte 1 marcamos como anti-patrón: analizadores con versión dentro de `Directory.Build.props`.

## Dependencias transitivas: transitive pinning

Los paquetes que usas traen sus propias dependencias. Si una tiene una vulnerabilidad, no puedes esperar a que el autor del paquete intermedio publique una versión nueva. Con transitive pinning, una versión declarada en `Directory.Packages.props` también se aplica a las dependencias transitivas:

```xml
<PropertyGroup>
  <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  <CentralPackageTransitivePinningEnabled>true</CentralPackageTransitivePinningEnabled>
</PropertyGroup>

<ItemGroup Label="Security pins">
  <!-- Dependencia transitiva fijada por seguridad. Revisar al actualizar el paquete que la trae -->
  <PackageVersion Include="System.Text.Json" Version="10.0.0" />
</ItemGroup>
```

No hace falta añadir un `PackageReference` en ningún proyecto. Basta con declarar la versión en el fichero central y NuGet la usa en lugar de la que pide el paquete intermedio.

Agrupa estos pins en un `ItemGroup` propio con un comentario. Así, cuando actualices el paquete que trae la dependencia, es fácil comprobar si el pin sigue haciendo falta.

## Cadena de suministro: NuGetAudit, Package Source Mapping y lock files

Centralizar versiones es el primer paso. Con tres piezas más, el fichero central sirve de base a una cadena de suministro segura.

### NuGetAudit: vulnerabilidades en cada restore

NuGet comprueba los paquetes contra la base de datos de avisos de seguridad durante el restore y emite warnings de `NU1901` a `NU1904` según la gravedad. Conviene fijar el comportamiento de forma explícita en `Directory.Build.props`:

```xml
<PropertyGroup>
  <NuGetAudit>true</NuGetAudit>
  <!-- Revisa también las dependencias transitivas -->
  <NuGetAuditMode>all</NuGetAuditMode>
  <NuGetAuditLevel>moderate</NuGetAuditLevel>
</PropertyGroup>
```

Si un aviso no aplica a tu caso, silénciaselo con un item `NuGetAuditSuppress` y la URL del aviso, en lugar de rebajar el nivel global.

### Package Source Mapping: cada paquete, de su feed

Si usas un feed privado además de nuget.org, indica en `nuget.config` de qué origen puede venir cada paquete. Así evitas que alguien publique en nuget.org un paquete con el nombre de uno interno (*dependency confusion*):

```xml
<!-- nuget.config -->
<packageSourceMapping>
  <packageSource key="nuget.org">
    <package pattern="*" />
  </packageSource>
  <packageSource key="contoso">
    <package pattern="Contoso.*" />
  </packageSource>
</packageSourceMapping>
```

Con CPM y varios orígenes sin mapping, NuGet emite el aviso `NU1507` justamente para recordártelo.

### Lock files: restores reproducibles

Un fichero `packages.lock.json` por proyecto registra la versión exacta de cada dependencia, transitivas incluidas. En CI, el modo bloqueado hace fallar el build si el resultado del restore no coincide:

```xml
<!-- Directory.Build.props -->
<PropertyGroup>
  <RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>
</PropertyGroup>
```

```bash
dotnet restore --locked-mode
```

## Automatización: Dependabot y Renovate

Dependabot y Renovate entienden `Directory.Packages.props`. Cuando sale una versión nueva abren un único PR que cambia una línea del fichero central, en lugar de uno que toca todos los `.csproj`.

Una configuración mínima de Dependabot en GitHub:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "nuget"
    directory: "/"
    schedule:
      interval: "weekly"
    groups:
      microsoft:
        patterns: ["Microsoft.*", "System.*"]
      testing:
        patterns: ["xunit*", "Moq", "coverlet*"]
```

Los `groups` juntan en un mismo PR los paquetes que suelen actualizarse a la vez, como la familia de Entity Framework Core. Salen menos PRs y cada uno tiene sentido por sí solo.

Para revisar el estado sin esperar al bot, el CLI funciona igual con CPM:

```bash
dotnet list package --outdated
dotnet list package --vulnerable --include-transitive
```

## Migrar una solución existente

La migración es mecánica si sigues un orden:

1. Haz un inventario. Lista las versiones que usa cada proyecto con `dotnet list package` y localiza los paquetes con versiones distintas.
2. Decide una versión por paquete. Normalmente la más alta que ya funciona en algún proyecto. Lo que no se pueda unificar todavía será un `VersionOverride` documentado.
3. Crea el fichero central con `dotnet new packagesprops` y añade un `PackageVersion` por paquete.
4. Quita el atributo `Version` de los `PackageReference` de todos los `.csproj`.
5. Compila y resuelve los errores. `NU1008` indica una versión que se te ha quedado en un `.csproj`; `NU1010`, un paquete que falta en el fichero central.
6. Valida en CI con la batería completa de tests antes de fusionar.

Hazlo en un PR dedicado, sin mezclarlo con actualizaciones de versión. Si el PR solo centraliza, cualquier fallo apunta a la migración. Si además sube versiones, no sabrás qué lo ha causado.

## Gobernanza: quién decide las versiones

Igual que con `Directory.Build.props`, el fichero central merece una revisión específica. En `CODEOWNERS`:

```text
# .github/CODEOWNERS
/Directory.Packages.props   @contoso/architecture
/nuget.config               @contoso/architecture
```

Así, añadir un paquete nuevo a la solución pasa por una revisión de arquitectura: licencia, mantenimiento, alternativas ya aprobadas. Usar los que ya están declarados sigue siendo libre.

También conviene alinear a Copilot en `.github/copilot-instructions.md`:

```markdown
## NuGet packages
- The solution uses Central Package Management.
- Never add a Version attribute to PackageReference items.
- To add a new package, add a PackageVersion entry to
  Directory.Packages.props and a PackageReference without version
  to the project.
- Do not use VersionOverride unless explicitly requested.
```

## Beneficios para equipos de desarrollo

CPM consigue que las decisiones sobre dependencias se tomen una vez, en un sitio visible y con revisión. En el día a día se nota así:

- Todo el equipo sabe qué versión de cada paquete usa la solución mirando un solo fichero.
- Desaparecen los downgrades y los errores que solo aparecían al combinar dos proyectos.
- Corregir una vulnerabilidad, incluso en una dependencia transitiva, es cambiar una línea.
- Dependabot o Renovate abren cambios de una línea, agrupados por familias de paquetes, y se revisan de verdad.
- Cada `VersionOverride` está a una búsqueda de distancia, con su motivo y su ticket.
- Los analizadores llegan a todos los proyectos con una sola declaración y sin contaminar los paquetes que publicas.
- Las vulnerabilidades saltan en el restore, los paquetes solo pueden venir de su feed y los restores en CI son reproducibles.
- Añadir una dependencia nueva pasa por arquitectura y usar las aprobadas es libre.

## Conclusión de la serie

Con las dos partes, la raíz del repositorio cuenta cómo se construye tu software:

```text
repo/
├── Directory.Build.props      <- cómo se compila: lenguaje, calidad, versionado
├── Directory.Packages.props   <- con qué se compila: paquetes y versiones
├── nuget.config               <- de dónde vienen los paquetes
├── .editorconfig              <- cómo se escribe el código
└── .github/
    ├── CODEOWNERS             <- quién decide sobre todo lo anterior
    └── copilot-instructions.md
```

Con unos pocos ficheros, las normas del equipo las comprueba el build en cada commit. La parte de calidad (analizadores, `.editorconfig` y warnings como errores) la desarrollo en [otro post](/2026-09-14-estandares-lenguaje-calidad-dotnet).
