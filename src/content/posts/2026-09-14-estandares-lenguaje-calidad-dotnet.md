---
title: "Estándares de lenguaje y calidad en .NET: que el compilador haga cumplir las normas"
subtitle: Analizadores, .editorconfig, warnings como errores y cómo adoptarlo en una solución que ya existe
date: 2026-09-14
topic: desarrollo
published: true
---

Toda empresa tiene una guía de estilo y unas buenas prácticas de código. El problema es que casi siempre viven en una wiki, y lo que vive en una wiki se olvida. Este post complementa la serie sobre gobernanza de soluciones .NET: si no has leído el de [Directory.Build.props](/2026-09-12-directory-build-props-contrato-calidad), empieza por ahí.

Aquí llevamos esas normas a `Directory.Build.props` y `.editorconfig` para que el compilador las aplique en cada build, y vemos cómo hacerlo en una solución existente sin bloquear al equipo. Al final cuento el efecto que más se nota cuando esto funciona.

## Lenguaje: la base común

Lo primero es que todos los proyectos hablen el mismo C#. Bastan tres propiedades, más una cuarta que conviene no tocar:

```xml
<!-- Directory.Build.props -->
<PropertyGroup Label="Language">
  <TargetFramework>net10.0</TargetFramework>
  <Nullable>enable</Nullable>
  <ImplicitUsings>enable</ImplicitUsings>
</PropertyGroup>
```

| Propiedad | Qué consigue | Recomendación |
| --- | --- | --- |
| `TargetFramework` | Todos los proyectos compilan contra la misma versión de .NET. | La LTS vigente, salvo que un proyecto necesite otra de forma justificada. |
| `Nullable` | El compilador avisa cuando usas algo que puede ser `null` sin comprobarlo. | `enable` en todos los proyectos nuevos. |
| `ImplicitUsings` | Los `using` más habituales (`System`, `System.Linq`...) se añaden solos. | `enable`, y los `using` globales propios en un fichero `GlobalUsings.cs`. |
| `LangVersion` | Fija la versión de C#. | No la declares. Por defecto se usa la versión de C# asociada al framework, que es la combinación que prueba Microsoft. |

El último punto merece una explicación. Poner `LangVersion` a `latest` o `preview` te deja usar características del lenguaje que el runtime de tu framework puede no soportar del todo. Si dejas que `TargetFramework` decida, te ahorras esa clase de problemas y, además, actualizar el framework actualiza también el lenguaje.

## Analizadores de .NET: elige el nivel de exigencia

El SDK incluye analizadores de calidad (reglas `CAxxxx`) que detectan errores habituales: problemas de rendimiento, de seguridad, de uso incorrecto de APIs. Están activados por defecto, pero con un conjunto mínimo de reglas. La propiedad `AnalysisLevel` decide cuántas se aplican:

```xml
<PropertyGroup Label="Quality">
  <AnalysisLevel>latest-recommended</AnalysisLevel>
</PropertyGroup>
```

El valor tiene dos partes: la versión de las reglas (`latest`, `preview` o un número como `10.0`) y el modo, que indica cuántas se activan:

| Modo | Qué activa | Para quién |
| --- | --- | --- |
| *(sin sufijo)* | Unas pocas reglas como warning | El comportamiento por defecto |
| `-minimum` | Las reglas más importantes | Soluciones grandes que empiezan a adoptar analizadores |
| `-recommended` | Un conjunto amplio y equilibrado | El punto de partida que recomiendo |
| `-all` | Todas las reglas como warning | Librerías públicas o equipos muy exigentes; suele ser ruidoso |

Usar `latest` en lugar de un número fijo tiene una consecuencia: al actualizar el SDK pueden aparecer warnings nuevos. Es lo que queremos, porque las reglas mejoran sin que hagamos nada, pero conviene que el equipo lo sepa para que no se lleve sorpresas tras una actualización.

Si una categoría concreta necesita otro nivel, se ajusta por separado. Por ejemplo, para ser más estrictos solo con las reglas de seguridad: `<AnalysisModeSecurity>All</AnalysisModeSecurity>`.

## Estilo de código: .editorconfig y EnforceCodeStyleInBuild

Las reglas de estilo (`IDExxxx`: llaves, `var`, nombres, `using` sin usar...) se configuran en `.editorconfig`, no en `Directory.Build.props`. El reparto es sencillo:

- `Directory.Build.props` decide qué se comprueba al compilar.
- `.editorconfig` decide cada regla y con qué severidad.

Por defecto, las reglas de estilo solo se muestran en el IDE. Para que el build también las compruebe hay que activarlo:

```xml
<PropertyGroup Label="Quality">
  <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>
  <!-- Necesario para que IDE0005 (usings sin usar) se compruebe al compilar -->
  <GenerateDocumentationFile>true</GenerateDocumentationFile>
  <!-- CS1591: miembro público sin comentario XML. Lo silenciamos para no obligar a documentarlo todo -->
  <NoWarn>$(NoWarn);CS1591</NoWarn>
</PropertyGroup>
```

Y en `.editorconfig`, la severidad de cada regla con la sintaxis `dotnet_diagnostic`, que es la que entiende el compilador:

```ini
# .editorconfig
root = true

[*.cs]
# Usings sin usar
dotnet_diagnostic.IDE0005.severity = warning
# Formato (espacios, sangría, saltos de línea)
dotnet_diagnostic.IDE0055.severity = warning
# Preferir 'var' cuando el tipo es evidente
csharp_style_var_when_type_is_apparent = true
dotnet_diagnostic.IDE0007.severity = warning
```

Lo bueno de este enfoque es que buena parte del estilo se corrige sola:

```bash
# Arregla lo que pueda arreglarse automáticamente
dotnet format

# En CI: falla si hay algo sin formatear
dotnet format --verify-no-changes
```

## Warnings como errores: cuándo y cómo

Un warning que no rompe el build acaba ignorado. Pero convertir todos en errores desde el primer día también cuesta: mientras programas, una variable sin usar te impide compilar. Hay tres estrategias, de menos a más estricta.

La primera es convertir en error solo algunos warnings, por ejemplo los de nulabilidad, que son los que más bugs evitan:

```xml
<PropertyGroup>
  <WarningsAsErrors>$(WarningsAsErrors);nullable</WarningsAsErrors>
</PropertyGroup>
```

La segunda es convertirlos todos en error, pero solo en CI. En local se trabaja con libertad y el PR no se puede fusionar con warnings:

```xml
<PropertyGroup Label="CI">
  <IsCiBuild Condition="'$(TF_BUILD)' == 'true' Or '$(GITHUB_ACTIONS)' == 'true' Or '$(JENKINS_URL)' != ''">true</IsCiBuild>
</PropertyGroup>

<PropertyGroup Condition="'$(IsCiBuild)' == 'true'">
  <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
</PropertyGroup>
```

Azure DevOps, GitHub Actions y Jenkins definen `TF_BUILD`, `GITHUB_ACTIONS` y `JENKINS_URL` automáticamente. Ajusta la lista a los sistemas de CI que uses.

La tercera es `TreatWarningsAsErrors` sin condición. Es la opción más coherente, pero exige que la solución ya esté limpia de warnings y que el equipo esté acostumbrado.

Para la mayoría de equipos recomiendo la segunda, combinada con la primera para que la nulabilidad sea error también en local. Y si una regla concreta no aporta en tu contexto, desactívala en `.editorconfig` con `severity = none` y un comentario, en lugar de rebajar el criterio general.

## Analizadores de terceros

Los analizadores del SDK cubren mucho, pero no todo. Algunos paquetes populares añaden reglas útiles:

| Paquete | Aporta |
| --- | --- |
| `SonarAnalyzer.CSharp` | Reglas de bugs, code smells y seguridad; las mismas que SonarQube, pero en el IDE y en el build. |
| `Meziantou.Analyzer` | Buenas prácticas de .NET y de uso de APIs, con reglas muy concretas. |
| `Roslynator.Analyzers` | Cientos de reglas de simplificación y estilo, con sus correcciones automáticas. |

No los añadas todos a la vez. Muchas reglas se solapan y, con tanto ruido, el equipo deja de leer los avisos. Empieza por uno, ajusta sus reglas en `.editorconfig` y suma el siguiente solo si aporta algo que no tengas.

Para incluirlos en todos los proyectos, el sitio correcto es `GlobalPackageReference` en `Directory.Packages.props`, como vimos en el post de [Central Package Management](/2026-09-13-central-package-management-nuget). Así no se propagan a quien consuma tus librerías.

## Adopción gradual en una solución existente

Activar todo esto de golpe en una solución con años de historia puede producir miles de warnings y un equipo frustrado. El orden que mejor me ha funcionado:

1. Activa los analizadores como warnings, sin errores. Mide cuántos aparecen y de qué tipo; te dará una idea real del esfuerzo.
2. Aplica primero lo automático. `dotnet format` corrige solo la mayor parte de los avisos de estilo. Hazlo en un PR dedicado, sin cambios de lógica, para que la revisión sea trivial.
3. Activa Nullable proyecto a proyecto. En los que aún no lo tienen, empieza por `<Nullable>warnings</Nullable>`: avisa de posibles nulos sin obligarte a anotar todo el código. Cuando el proyecto esté limpio, pasa a `enable`.
4. Documenta las excepciones y no las hagas nunca globales. Si un proyecto no puede cumplir una regla todavía, desactívala solo en ese proyecto, con un comentario y un ticket.
5. Activa los errores en CI cuando la solución esté limpia. `TreatWarningsAsErrors` entra cuando los warnings llegan a cero, para que no vuelvan a subir.

Mi regla: el código nuevo cumple el estándar desde el primer día y el existente se va poniendo al día de forma incremental.

## Beneficios para equipos de desarrollo

Lo que más se nota es que las code reviews cambian de tema, más que el número de warnings. Cuando el build ya ha comprobado el estilo, la nulabilidad y los errores habituales, la revisión se dedica al diseño y a la lógica de negocio. Y de ahí viene el resto:

- Nadie vuelve a comentar "falta un espacio" o "este `using` sobra".
- Hay menos bugs en producción, porque Nullable y los analizadores detectan antes de compilar errores que de otro modo aparecerían en ejecución.
- El estilo deja de ser opinión de quien revisa. Lo define un fichero versionado que cualquiera puede proponer cambiar.
- Quien se incorpora aprende las normas del equipo al ver los avisos en su IDE, sin documentos que leer.
- Cada aviso de un analizador enlaza a su documentación, así que el equipo aprende buenas prácticas de .NET mientras programa.
- Con errores en CI, el número de warnings no puede volver a subir.
- El enfoque gradual permite mejorar soluciones existentes sin parar la entrega.

## Conclusión y fichero completo

Con todo lo visto, la parte de calidad del `Directory.Build.props` queda así:

```xml
<Project>
  <PropertyGroup Label="Language">
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>

  <PropertyGroup Label="Quality">
    <AnalysisLevel>latest-recommended</AnalysisLevel>
    <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>
    <GenerateDocumentationFile>true</GenerateDocumentationFile>
    <NoWarn>$(NoWarn);CS1591</NoWarn>
    <WarningsAsErrors>$(WarningsAsErrors);nullable</WarningsAsErrors>
  </PropertyGroup>

  <PropertyGroup Label="CI">
    <IsCiBuild Condition="'$(TF_BUILD)' == 'true' Or '$(GITHUB_ACTIONS)' == 'true' Or '$(JENKINS_URL)' != ''">true</IsCiBuild>
  </PropertyGroup>

  <PropertyGroup Condition="'$(IsCiBuild)' == 'true'">
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  </PropertyGroup>
</Project>
```

Son veinte líneas en lugar de una página de wiki. Junto con `.editorconfig` para el estilo y `Directory.Packages.props` para los analizadores de terceros, tu solución tiene unas normas de calidad que se cumplen solas en cada build.
