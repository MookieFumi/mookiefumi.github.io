---
title: "Mini laboratorio: la gobernanza de .NET en GitHub Actions"
subtitle: Restore bloqueado, warnings como errores, formato, vulnerabilidades y CODEOWNERS ejecutados en cada pull request
date: 2026-09-20
topic: desarrollo
published: false
---

En la serie sobre gobernanza de soluciones .NET dejamos las normas en ficheros del repositorio: [Directory.Build.props](/2026-09-12-directory-build-props-contrato-calidad), [Central Package Management](/2026-09-13-central-package-management-nuget) y los [estándares de lenguaje y calidad](/2026-09-14-estandares-lenguaje-calidad-dotnet). Esos ficheros solo valen si algo comprueba que se cumplen en cada cambio. En un repositorio de GitHub ese algo es un workflow de Actions.

Este laboratorio es corto. Parto de la solución de ejemplo de la serie (`Payments.sln` con `src/` y `tests/`) y añado un workflow por cada decisión que ya habíamos tomado. Cada apartado indica de qué parte viene.

## Lo que ya tenemos y lo que falta

El build local ya hace bastante, pero un pull request puede llegar con warnings, con el código sin formatear o con un paquete vulnerable, porque nadie estaba obligado a compilar antes de subirlo. Lo que queremos que pase en CI:

| Comprobación | Viene de | Cómo se ejecuta |
| --- | --- | --- |
| Restore reproducible | Parte 2 (lock files) | `dotnet restore --locked-mode` |
| Warnings como errores | Parte 3 | `TreatWarningsAsErrors` cuando detecta `GITHUB_ACTIONS` |
| Formato | Parte 3 | `dotnet format --verify-no-changes` |
| Propiedades centralizadas | Parte 1 | Un `grep` sobre los `.csproj` |
| Vulnerabilidades | Parte 2 (NuGetAudit) | `dotnet list package --vulnerable` |
| Quién revisa los ficheros del estándar | Partes 1 y 2 | `CODEOWNERS` y protección de rama |

Para que el restore bloqueado funcione, `Directory.Build.props` tiene que activar los lock files, como vimos en la parte 2:

```xml
<PropertyGroup>
  <RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>
</PropertyGroup>
```

Y hay que haber generado y subido los `packages.lock.json` con un `dotnet restore` local. Sin esos ficheros, `--locked-mode` falla en el primer pull request.

## El workflow principal: restore, build, formato y tests

Un solo fichero cubre lo que cualquier PR debe cumplir:

```yaml
# .github/workflows/ci.yml
name: ci

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-dotnet@v4
        with:
          global-json-file: global.json
          cache: true
          cache-dependency-path: "**/packages.lock.json"

      - name: Restore (bloqueado)
        run: dotnet restore --locked-mode

      - name: Build
        run: dotnet build --no-restore -c Release

      - name: Formato
        run: dotnet format --verify-no-changes --no-restore

      - name: Tests
        run: dotnet test --no-build -c Release
```

Varias cosas de este fichero tienen su origen en la serie:

- `--locked-mode` hace fallar el restore si alguna dependencia, transitivas incluidas, no coincide con el lock file. Es lo que garantiza que CI compila lo mismo que compilaste tú.
- El paso de build no lleva ningún flag de warnings. `Directory.Build.props` detecta la variable `GITHUB_ACTIONS` y activa `TreatWarningsAsErrors` solo en CI, tal como lo dejamos en la parte 3. En local sigues trabajando con libertad y el PR no se puede fusionar con avisos.
- `dotnet format --verify-no-changes` termina con código distinto de cero si hay algo sin formatear. Cuando falla, el arreglo es ejecutar `dotnet format` en local y subir el resultado.
- `cache-dependency-path` apunta a los lock files, así que la caché de NuGet se invalida solo cuando cambian las dependencias.
- `global-json-file` evita repetir la versión del SDK en el workflow. Si no tienes `global.json`, usa `dotnet-version: 10.0.x`.
- `concurrency` cancela la ejecución anterior de la misma rama cuando subes otro commit, que ahorra minutos en PRs con varios empujes seguidos.

## Que nadie se salte Directory.Build.props

En la parte 1 propusimos un paso que falla si un `.csproj` redefine propiedades que deberían vivir en el fichero central. Aquí queda como un job aparte, que tarda un segundo y da un mensaje claro:

```yaml
# .github/workflows/governance.yml
name: governance

on:
  pull_request:

permissions:
  contents: read

jobs:
  centralized-properties:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Propiedades que solo pueden definirse en Directory.Build.props
        run: |
          if grep -rlE "<(TargetFramework|Nullable|LangVersion|TreatWarningsAsErrors)>" \
               --include=*.csproj src tests; then
            echo "::error::Common properties must be defined in Directory.Build.props"
            exit 1
          fi
```

El prefijo `::error::` hace que el mensaje aparezca como anotación en el PR, no enterrado en el log. Como avisé en la parte 1, mete aquí solo las propiedades que no admiten excepciones. Si un proyecto tiene una excepción documentada, mantén una lista de proyectos excluidos dentro del script en lugar de relajar la regla para todos.

Con CPM activo no hace falta un check equivalente para las versiones de paquetes: un `PackageReference` con `Version` ya rompe el build con `NU1008`, y uno sin su `PackageVersion` con `NU1010`.

## Vulnerabilidades en cada pull request

NuGetAudit avisa durante el restore, pero un warning no impide fusionar. Para que sí lo impida hay dos opciones y se complementan.

La primera es mirar el estado real de la solución con el CLI. `dotnet list package --vulnerable` devuelve siempre código 0, así que hay que leer su salida:

```yaml
  vulnerabilities:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-dotnet@v4
        with:
          global-json-file: global.json

      - name: Paquetes vulnerables (incluye transitivos)
        run: |
          dotnet restore --locked-mode
          dotnet list package --vulnerable --include-transitive 2>&1 | tee report.txt
          if grep -q "has the following vulnerable packages" report.txt; then
            echo "::error::Vulnerable packages found"
            exit 1
          fi
```

Este job va en `governance.yml`, debajo del anterior. Detecta lo que ya está en la solución, así que también saltará cuando aparezca un aviso nuevo sobre un paquete que llevabas meses usando. Es el comportamiento que queremos, pero conviene avisar al equipo de que un PR ajeno puede ponerse rojo por eso.

La segunda es mirar solo lo que cambia el PR con la acción de revisión de dependencias de GitHub:

```yaml
  dependency-review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/dependency-review-action@v4
        with:
          fail-on-severity: moderate
```

Compara el grafo de dependencias de la rama base con el del PR y falla si se añade algo con una vulnerabilidad de severidad moderada o superior. Es la más útil para dependencias nuevas, porque señala el paquete que introduce el PR y no el estado general. Necesita que el grafo de dependencias esté activo en el repositorio, y en repositorios privados requiere GitHub Advanced Security.

## Informe semanal de paquetes desactualizados

Para lo que no debe bloquear nada, un workflow programado que deje el informe en el resumen de la ejecución:

```yaml
# .github/workflows/outdated.yml
name: outdated

on:
  schedule:
    - cron: "0 7 * * 1"
  workflow_dispatch:

permissions:
  contents: read

jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-dotnet@v4
        with:
          global-json-file: global.json

      - name: Informe
        run: |
          dotnet restore
          {
            echo '## Paquetes desactualizados'
            echo '~~~text'
            dotnet list package --outdated --include-transitive
            echo '~~~'
          } >> "$GITHUB_STEP_SUMMARY"
```

No sustituye a Dependabot, que ya abre los PRs de actualización agrupados como vimos en la parte 2. Sirve para ver de un vistazo cuánto se ha acumulado cuando los PRs del bot llevan tiempo sin revisarse.

## Quién revisa los cambios del estándar

Todo lo anterior comprueba el código. Falta controlar quién puede cambiar las reglas, y eso no lo hace Actions: lo hace `CODEOWNERS` junto con la protección de rama. El fichero reúne lo que fuimos listando en las tres partes:

```text
# .github/CODEOWNERS
/Directory.Build.props        @contoso/architecture
/Directory.Build.targets      @contoso/architecture
/tests/Directory.Build.props  @contoso/architecture
/Directory.Packages.props     @contoso/architecture
/nuget.config                 @contoso/architecture
/.editorconfig                @contoso/architecture
/global.json                  @contoso/architecture
/.github/workflows/           @contoso/architecture
```

La última línea es la que se olvida con más facilidad. Si cualquiera puede editar los workflows, puede quitar los checks que acabamos de montar, así que las carpetas de `.github/workflows/` también tienen que pasar por arquitectura.

En la regla de protección de la rama principal hay que marcar dos cosas: exigir la revisión de los code owners y exigir que pasen los checks `build`, `centralized-properties`, `vulnerabilities` y `dependency-review`. Sin eso los workflows avisan, pero se puede fusionar igualmente.

## Llevarlo a varios repositorios

Con un repositorio es un copiar y pegar. Con diez, los workflows también acaban divergiendo. GitHub permite definir un workflow reutilizable en un repositorio central y llamarlo desde los demás:

```yaml
# En cada repositorio: .github/workflows/ci.yml
name: ci

on:
  pull_request:
  push:
    branches: [main]

jobs:
  dotnet:
    uses: contoso/platform-workflows/.github/workflows/dotnet-ci.yml@v1
    with:
      solution: Payments.sln
```

En el repositorio de plataforma, el workflow `dotnet-ci.yml` declara `on: workflow_call` con el input `solution` y contiene los pasos de restore, build, formato y tests de arriba. Cada repositorio mantiene una llamada de seis líneas, y cambiar una norma de CI es publicar una versión nueva de ese fichero. La etiqueta `@v1` importa: apuntar a una rama haría que cualquier cambio llegara a todos los repositorios sin que nadie lo revise.

## Antes de poner todo en obligatorio

Si la solución ya tiene años, activar estos checks de golpe pone todos los PRs en rojo. Mantengo el orden de adopción de la parte 3:

1. Empieza con `build` sin la comprobación de formato, y con warnings solo como avisos.
2. Abre un PR dedicado con el resultado de `dotnet format`, sin cambios de lógica, y activa entonces el paso de formato.
3. Activa `vulnerabilities` y `dependency-review`, que suelen estar limpios o tienen un arreglo de una línea en `Directory.Packages.props`.
4. Marca los checks como obligatorios en la protección de rama cuando lleven una semana en verde.
5. Añade `CODEOWNERS` el último, cuando el equipo de arquitectura sepa cuántas revisiones va a recibir.

## Qué queda de la serie

Con esto, la raíz del repositorio ya no solo describe las normas del equipo: un workflow las comprueba en cada pull request y `CODEOWNERS` decide quién puede cambiarlas.

```text
repo/
├── Directory.Build.props
├── Directory.Packages.props
├── nuget.config
├── .editorconfig
├── global.json
└── .github/
    ├── CODEOWNERS
    ├── dependabot.yml
    └── workflows/
        ├── ci.yml
        ├── governance.yml
        └── outdated.yml
```
