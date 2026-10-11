---
title: "Directory.Build.props: el contrato de calidad de tu solución .NET"
subtitle: Cómo MSBuild lo encuentra, qué conviene centralizar, qué no y cómo gobernarlo en equipo
date: 2026-09-12
topic: desarrollo
published: true
---

Un único `Directory.Build.props` en la raíz del repositorio convierte las reglas de tu equipo en algo que aplica el compilador, no en una página de wiki que nadie lee. Este es el primer post de una serie sobre gobernanza de soluciones .NET; en el segundo veremos Central Package Management.

Aquí repaso cómo funciona, qué merece la pena centralizar y cómo evitar que se convierta en un cajón de sastre. Al final cuento qué gana un equipo cuando el build deja de depender de la memoria de las personas.

## El problema: la misma configuración en cada .csproj

Abre cualquier solución de microservicios con unos años encima y verás esto en cada proyecto:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <LangVersion>latest</LangVersion>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <Company>Contoso</Company>
    <Authors>Equipo Plataforma</Authors>
  </PropertyGroup>
</Project>
```

Multiplícalo por 30 o 40 proyectos y salen los síntomas de siempre:

- Un proyecto se queda en `net8.0` y otro lleva un año con `Nullable` desactivado "temporalmente".
- Subir el framework o activar un analizador toca decenas de ficheros y los PRs se llenan de ruido.
- Las reglas viven en la cabeza del tech lead, no en el repositorio.
- Los proyectos nuevos se copian de uno antiguo y heredan sus excepciones.

MSBuild tiene una solución nativa desde hace años que se usa menos de lo que debería: `Directory.Build.props`.

## Cómo encuentra MSBuild el Directory.Build.props

MSBuild busca un fichero con ese nombre empezando en la carpeta del proyecto y subiendo nivel a nivel hasta la raíz del disco. Importa el primero que encuentra y deja de buscar. No hace falta referenciarlo desde ningún `.csproj`, porque el SDK lo importa solo.

```text
C:\repos\payments\
├── Directory.Build.props          <- lo importan todos los proyectos de abajo
├── Payments.sln
├── src\
│   ├── Payments.Api\Payments.Api.csproj
│   └── Payments.Domain\Payments.Domain.csproj
└── tests\
    └── Payments.Api.Tests\Payments.Api.Tests.csproj
```

La forma más rápida de crearlo es con la plantilla del SDK, disponible desde .NET 8:

```bash
dotnet new buildprops
```

Como gana el primero que se encuentra, hay dos consecuencias:

1. Pon siempre uno en la raíz del repositorio. Así la búsqueda se detiene ahí y ningún fichero perdido en una carpeta superior (el perfil del usuario, el agente de CI) se cuela en tu build.
2. Si añades otro en una subcarpeta, oculta al de la raíz salvo que lo importes de forma explícita. Lo vemos en el apartado de jerarquía.

Si un proyecto concreto necesita quedarse fuera, puede desactivarlo con `<ImportDirectoryBuildProps>false</ImportDirectoryBuildProps>`. En la práctica, necesitarlo suele indicar que algo está mal planteado.

## .props frente a .targets: el orden de importación importa

`Directory.Build.props` se importa al principio de la evaluación, antes del contenido del `.csproj`. `Directory.Build.targets` se importa al final, después del `.csproj` y de los targets del SDK. Esa diferencia decide qué va en cada fichero.

| Fichero | Cuándo se importa | Para qué |
| --- | --- | --- |
| `Directory.Build.props` | Antes del `.csproj` | Valores por defecto que cada proyecto puede sobrescribir: `TargetFramework`, `Nullable`, metadatos |
| `.csproj` | En medio | Lo que hace distinto a ese proyecto |
| `Directory.Build.targets` | Después del `.csproj` | Lógica que depende de propiedades que ya define el proyecto, targets propios, imposiciones que no deben sobrescribirse |

Una confusión habitual: esta condición en un `.props` nunca se cumple, porque cuando se evalúa todavía no se ha leído el `.csproj` y `TargetFramework` está vacío.

```xml
<!-- Directory.Build.props: NO funciona -->
<PropertyGroup Condition="'$(TargetFramework)' == 'net10.0'">
  <EnablePreviewFeatures>true</EnablePreviewFeatures>
</PropertyGroup>
```

En un `Directory.Build.targets` la misma condición sí funciona, porque el proyecto ya está evaluado. Las propiedades reservadas como `$(MSBuildProjectName)` están disponibles desde el principio y se pueden usar en el `.props`:

```xml
<!-- Directory.Build.props: SÍ funciona -->
<PropertyGroup Condition="$(MSBuildProjectName.EndsWith('.Tests'))">
  <IsPackable>false</IsPackable>
</PropertyGroup>
```

La regla práctica que uso: valores por defecto en el `.props`, decisiones que dependen del proyecto en el `.targets`.

## Jerarquía multinivel: configuración distinta para src y tests

Los proyectos de test suelen necesitar reglas propias. No se empaquetan, no generan documentación XML y toleran algunos avisos que en producción no pasarían. La solución es un segundo `Directory.Build.props` en `tests/` que importa explícitamente el de la raíz y añade lo suyo.

```text
repo/
├── Directory.Build.props              <- reglas comunes
├── src/
│   └── ...
└── tests/
    ├── Directory.Build.props          <- importa el de la raíz + reglas de test
    └── Payments.Api.Tests/
```

```xml
<!-- tests/Directory.Build.props -->
<Project>
  <!-- Sin esta línea, el fichero de la raíz se ignora para los tests -->
  <Import Project="$([MSBuild]::GetPathOfFileAbove('Directory.Build.props', '$(MSBuildThisFileDirectory)../'))" />

  <PropertyGroup>
    <IsPackable>false</IsPackable>
    <IsTestProject>true</IsTestProject>
    <GenerateDocumentationFile>false</GenerateDocumentationFile>
  </PropertyGroup>

  <ItemGroup>
    <Using Include="Xunit" />
  </ItemGroup>
</Project>
```

`GetPathOfFileAbove` busca el fichero a partir de la carpeta padre, así que encuentra el de la raíz sin rutas relativas frágiles. Mi recomendación es no pasar de dos niveles: cada nivel extra es un sitio más donde mirar cuando una propiedad no tiene el valor que esperabas.

## Estándares de lenguaje y calidad

Ya sabemos dónde vive la configuración común. Falta decidir qué poner. Lo más valioso son las reglas de lenguaje y calidad: si están en `Directory.Build.props`, el compilador las aplica en cada build y nadie tiene que acordarse de ellas.

Un punto de partida mínimo:

```xml
<Project>
  <PropertyGroup>
    <!-- Lenguaje -->
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>

    <!-- Calidad -->
    <AnalysisLevel>latest-recommended</AnalysisLevel>
    <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>
  </PropertyGroup>
</Project>
```

| Propiedad | Qué consigue |
| --- | --- |
| `TargetFramework` | Todos los proyectos compilan contra la misma versión de .NET. |
| `Nullable` | El compilador avisa cuando usas algo que puede ser `null` sin comprobarlo. |
| `ImplicitUsings` | Los `using` más habituales (`System`, `System.Linq`...) se añaden solos. |
| `AnalysisLevel` | Activa los analizadores de .NET con el conjunto de reglas recomendado. |
| `EnforceCodeStyleInBuild` | Las reglas de estilo del `.editorconfig` se comprueban al compilar, no solo en el IDE. |

Hay mucho más que contar aquí: qué nivel de analizadores elegir, cómo se reparte el trabajo entre `Directory.Build.props` y `.editorconfig`, cuándo convertir warnings en errores y cómo activarlo en una solución existente sin bloquear al equipo. Todo eso lo desarrollo en [otro post](/2026-09-14-estandares-lenguaje-calidad-dotnet).

## Versionado centralizado de los artefactos

Si todos los proyectos de una solución se publican juntos, deberían compartir versión. `Directory.Build.props` es el sitio natural para declararla, y el pipeline completa lo que falta:

```xml
<PropertyGroup Label="Versioning">
  <!-- Versión base: se cambia a mano en cada release -->
  <VersionPrefix>2.4.0</VersionPrefix>
  <!-- En local, los builds se marcan como desarrollo -->
  <VersionSuffix Condition="'$(VersionSuffix)' == ''">dev</VersionSuffix>
</PropertyGroup>
```

En el pipeline se sobrescribe el sufijo, o la versión entera, desde fuera:

```bash
# Build de rama de release: 2.4.0-rc.17
dotnet build -c Release -p:VersionSuffix=rc.17

# Build final: 2.4.0 (sufijo vacío)
dotnet build -c Release -p:VersionSuffix=
```

Con este esquema, `Version`, `AssemblyVersion`, `FileVersion` e `InformationalVersion` salen de una sola fuente. El SDK además añade el hash del commit a `InformationalVersion`, así que cualquier ensamblado se puede rastrear hasta su origen.

El paso siguiente es calcular la versión a partir del historial de git con GitVersion o MinVer. Eso merece su propio laboratorio y lo dejo para otro post.

## Anti-patrones que conviene evitar

`Directory.Build.props` es potente justo porque no se ve desde el `.csproj`, y esa misma invisibilidad lo vuelve un problema cuando se abusa de él.

| Anti-patrón | Por qué duele | Alternativa |
| --- | --- | --- |
| Condiciones sobre `$(TargetFramework)` u otras propiedades del proyecto en el `.props` | Se evalúan antes de que el proyecto las defina y nunca se cumplen | Moverlas a `Directory.Build.targets` |
| Lógica por nombre de proyecto (`Condition="'$(MSBuildProjectName)' == 'Payments.Api'"`) | Esconde configuración específica lejos del proyecto que la usa | Dejarla en el propio `.csproj` |
| Más de dos niveles de `Directory.Build.props` | Averiguar de dónde sale un valor se convierte en una investigación | Raíz y `tests/` como máximo |
| `PackageReference` a analizadores con versión en el `.props` | Duplica la gestión de versiones y choca con CPM | `GlobalPackageReference` en `Directory.Packages.props` (parte 2) |
| Targets personalizados complejos (copias, generación de código) | El build se vuelve frágil y lento de diagnosticar | Una herramienta o un script explícito en el pipeline |
| Fichero sin comentarios | Nadie sabe por qué existe cada propiedad | `Label` en cada `PropertyGroup` y un comentario por cada decisión no obvia |

## Gobernanza: quién puede cambiar el contrato

Un fichero que afecta a todos los proyectos pide una revisión distinta a la de un cambio de negocio. En GitHub, lo más sencillo es `CODEOWNERS`:

```text
# .github/CODEOWNERS
/Directory.Build.props      @contoso/architecture
/Directory.Build.targets    @contoso/architecture
/tests/Directory.Build.props @contoso/architecture
/.editorconfig              @contoso/architecture
```

Con una regla de protección de rama que exija la aprobación de los code owners, cualquier cambio en el estándar pasa por arquitectura y el resto del código sigue su flujo normal.

Los asistentes de IA son el segundo frente. Si GitHub Copilot genera un `.csproj` nuevo con `TargetFramework` y `Nullable` dentro, rompe la centralización y en la review puede pasar desapercibido. Se arregla con una instrucción explícita en `.github/copilot-instructions.md`:

```markdown
## Project files
- Common build settings live in Directory.Build.props at the repository root.
- Do not add TargetFramework, Nullable, ImplicitUsings, LangVersion,
  TreatWarningsAsErrors or metadata properties to .csproj files.
- A .csproj should only contain what is specific to that project:
  SDK, project references and project-specific settings.
```

Un paso del pipeline puede reforzarlo y fallar si detecta propiedades centralizadas en algún `.csproj`:

```bash
if grep -rlE "<(TargetFramework|Nullable|LangVersion)>" --include=*.csproj src tests; then
  echo "Common properties must be defined in Directory.Build.props"; exit 1
fi
```

Mete en ese check solo las propiedades que no admiten excepciones. Si permites alguna documentada, por ejemplo un proyecto que todavía no ha activado Nullable, mantén una lista explícita de proyectos excluidos en el propio script.

## Beneficios para equipos de desarrollo

Esto es lo que cambia en el día a día de un equipo que adopta `Directory.Build.props`:

- Un `.csproj` nuevo hereda el estándar sin que nadie tenga que acordarse ni copiar de otro proyecto.
- Desaparece la deriva: no quedan proyectos olvidados en una versión antigua de .NET ni con `Nullable` apagado.
- Cambiar de framework o de versión es una línea en un fichero, no 40 `.csproj` tocados, y el PR se revisa en un minuto.
- El resultado del build no depende de la máquina ni de ficheros ajenos al repositorio.
- Las discusiones de estilo las resuelve el build antes de que lleguen a la revisión.
- Quien se incorpora recibe las reglas al clonar el repositorio, sin documentos que leer.
- Los tests tienen sus reglas sin duplicar configuración ni ensuciar los proyectos de producción.
- Todos los ensamblados de una release comparten versión, lo que simplifica soporte y hotfixes.
- Los equipos trabajan con libertad en su código, arquitectura revisa solo los ficheros que definen el estándar y Copilot genera código que ya cumple las convenciones.

## Conclusión y siguiente paso

En `Directory.Build.props` un equipo .NET declara cómo se construye su software. Con un fichero en la raíz, otro en `tests/` y una regla de CODEOWNERS, cualquier proyecto nuevo nace cumpliendo el estándar.

Lo que hemos centralizado:

- Lenguaje: framework, nullable y usings implícitos.
- Calidad: analizadores y estilo comprobado en el build.
- Versionado: una versión base y un sufijo que completa el pipeline.

Queda fuera una pieza: las versiones de los paquetes NuGet. Ponerlas en `Directory.Build.props` es tentador, pero hay una herramienta pensada para eso. En la parte 2 veremos Central Package Management con `Directory.Packages.props`, cómo usar `GlobalPackageReference` para los analizadores y cómo sumar NuGetAudit y Package Source Mapping para proteger la cadena de suministro.
