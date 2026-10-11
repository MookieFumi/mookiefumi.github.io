---
title: "Hacer cumplir las normas y estándares de .NET con GitHub Actions"
subtitle: Un único workflow comprueba en cada pull request lo que definen Directory.Build.props, Central Package Management y el .editorconfig
date: 2026-09-16
topic: desarrollo
published: false
---

En los posts sobre gobernanza de soluciones .NET dejamos las normas en ficheros del repositorio: [Directory.Build.props](/2026-09-12-directory-build-props-contrato-calidad), [Central Package Management](/2026-09-13-central-package-management-nuget) y los [estándares de lenguaje y calidad](/2026-09-14-estandares-lenguaje-calidad-dotnet). Esos ficheros solo valen si algo comprueba que se cumplen en cada cambio. En un repositorio de GitHub ese algo es un workflow de Actions.

Este laboratorio es corto. Parto de la solución de ejemplo de esos posts (`Payments.sln` con `src/` y `tests/`) y añado un workflow que comprueba cada decisión que ya habíamos tomado. La tabla indica de qué post viene cada una.

## Lo que ya tenemos y lo que falta

El build local ya hace bastante, pero un pull request puede llegar con warnings, con el código sin formatear o con un paquete vulnerable, porque nadie estaba obligado a compilar antes de subirlo. Lo que queremos que pase en CI:

| Comprobación | Viene de | Cómo se ejecuta |
| --- | --- | --- |
| Restore reproducible | Central Package Management (lock files) | `dotnet restore --locked-mode` |
| Warnings como errores | Estándares de lenguaje y calidad | `TreatWarningsAsErrors` cuando detecta `GITHUB_ACTIONS` |
| Formato | Estándares de lenguaje y calidad | `dotnet format --verify-no-changes` |
| Propiedades centralizadas | Directory.Build.props | Un `grep` sobre los `.csproj` |
| Vulnerabilidades | Central Package Management (NuGetAudit) | `dotnet list package --vulnerable` |
| Quién revisa los ficheros del estándar | Directory.Build.props y Central Package Management | `CODEOWNERS` y protección de rama |

Para que el restore bloqueado funcione, `Directory.Build.props` tiene que activar los lock files, como vimos en el post de Central Package Management:

```xml
<PropertyGroup>
  <RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>
</PropertyGroup>
```

Y hay que haber generado y subido los `packages.lock.json` con un `dotnet restore` local. Sin esos ficheros, `--locked-mode` falla en el primer pull request.

## Un solo workflow, un solo checkout

Lo más caro de un workflow de .NET es todo lo que ocurre antes de comprobar nada: el checkout, la instalación del SDK y el restore. Cada job arranca en un runner limpio y lo repite, mientras que las comprobaciones en sí tardan segundos. Por eso van todas en un único job, un paso por cada norma, con las baratas primero para que el PR falle cuanto antes:

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

      - name: Propiedades que solo pueden definirse en Directory.Build.props
        run: |
          if grep -rlE "<(TargetFramework|Nullable|LangVersion|TreatWarningsAsErrors)>" \
               --include=*.csproj src tests; then
            echo "::error::Common properties must be defined in Directory.Build.props"
            exit 1
          fi

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

      - name: Paquetes vulnerables (incluye transitivos)
        run: |
          dotnet list package --vulnerable --include-transitive --no-restore 2>&1 | tee report.txt
          if grep -q "has the following vulnerable packages" report.txt; then
            echo "::error::Vulnerable packages found"
            exit 1
          fi

      - name: Dependencias nuevas del PR
        if: github.event_name == 'pull_request'
        uses: actions/dependency-review-action@v4
        with:
          fail-on-severity: moderate
```

Qué hace cada paso y de dónde sale:

- El `grep` es el paso que propusimos en el post de Directory.Build.props: falla si un `.csproj` redefine propiedades que deberían vivir en el fichero central. El prefijo `::error::` hace que el mensaje aparezca como anotación en el PR, no enterrado en el log. Mete aquí solo las propiedades que no admiten excepciones. Si un proyecto tiene una excepción documentada, mantén una lista de proyectos excluidos dentro del script en lugar de relajar la regla para todos.
- `--locked-mode` hace fallar el restore si alguna dependencia, transitivas incluidas, no coincide con el lock file. Es lo que garantiza que CI compila lo mismo que compilaste tú.
- El paso de build no lleva ningún flag de warnings. `Directory.Build.props` detecta la variable `GITHUB_ACTIONS` y activa `TreatWarningsAsErrors` solo en CI, tal como lo dejamos en el post de estándares de calidad. En local sigues trabajando con libertad y el PR no se puede fusionar con avisos.
- `dotnet format --verify-no-changes` termina con código distinto de cero si hay algo sin formatear. Cuando falla, el arreglo es ejecutar `dotnet format` en local y subir el resultado.
- `dotnet list package --vulnerable` devuelve siempre código 0, así que hay que leer su salida. Reutiliza el restore de antes con `--no-restore`. Detecta lo que ya está en la solución, así que también saltará cuando aparezca un aviso nuevo sobre un paquete que llevabas meses usando. Es lo que queremos, pero conviene avisar al equipo de que un PR ajeno puede ponerse rojo por eso.
- `dependency-review-action` compara el grafo de dependencias de la rama base con el del PR y falla si se añade algo con una vulnerabilidad de severidad moderada o superior. Señala el paquete que introduce el PR y no el estado general, por eso solo se ejecuta en pull requests. Necesita que el grafo de dependencias esté activo en el repositorio, y en repositorios privados requiere GitHub Advanced Security.
- `cache-dependency-path` apunta a los lock files, así que la caché de NuGet se invalida solo cuando cambian las dependencias.
- `global-json-file` evita repetir la versión del SDK en el workflow. Si no tienes `global.json`, usa `dotnet-version: 10.0.x`.
- `concurrency` cancela la ejecución anterior de la misma rama cuando subes otro commit, que ahorra minutos en PRs con varios empujes seguidos.

Con CPM activo no hace falta un paso para las versiones de paquetes: un `PackageReference` con `Version` ya rompe el build con `NU1008`, y uno sin su `PackageVersion` con `NU1010`.

Separar en varios jobs solo compensa cuando una parte tarda de verdad, por ejemplo una batería de tests de varios minutos. Aun así, cada job extra paga otra vez el checkout y el restore, así que conviene medirlo antes.

## Informe semanal de paquetes desactualizados

Para lo que no debe bloquear nada, un workflow programado que deje el informe en el resumen de la ejecución. Aquí sí tiene sentido un fichero aparte, porque el disparador es otro y no hay pull request de por medio:

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

No sustituye a Dependabot, que ya abre los PRs de actualización agrupados como vimos en el post de Central Package Management. Sirve para ver de un vistazo cuánto se ha acumulado cuando los PRs del bot llevan tiempo sin revisarse.

## Quién revisa los cambios del estándar

Todo lo anterior comprueba el código. Falta controlar quién puede cambiar las reglas, y eso no lo hace Actions: lo hace `CODEOWNERS` junto con la protección de rama. El fichero reúne lo que fuimos listando en los tres posts:

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
/.github/actions/             @contoso/architecture
```

La última línea es la que se olvida con más facilidad. Si cualquiera puede editar los workflows, puede quitar los checks que acabamos de montar, así que las carpetas `.github/workflows/` y `.github/actions/` también tienen que pasar por arquitectura.

En la regla de protección de la rama principal hay que marcar dos cosas: exigir la revisión de los code owners y exigir que pase el check `build`, que reúne todos los pasos anteriores. Sin eso los workflows avisan, pero se puede fusionar igualmente.

## Empaquetarlo como preset

Tener los pasos en un `ci.yml` está bien para un repositorio. Para aplicarlos a otro, o a un workflow que ya existe, interesa más un preset: un bloque que se añade con una línea. GitHub ofrece dos formas de hacerlo y se eligen según lo que quieras reutilizar:

| Opción | Se usa como | Cuándo encaja |
| --- | --- | --- |
| Composite action | Un paso (`uses:`) dentro de un job | Añadir las comprobaciones a un workflow existente, compartiendo su checkout y su SDK |
| Workflow reutilizable | Un job entero (`uses:` a nivel de job) | Imponer un pipeline completo, con su propio runner |

Para lo que pedía este post encaja la composite action, porque corre dentro del job del llamador: el checkout, el SDK y el restore se hacen una sola vez, que era el objetivo. Los pasos de comprobación quedan en un `action.yml`:

```yaml
# .github/actions/dotnet-governance/action.yml
name: dotnet-governance
description: Comprueba las normas de gobernanza de una solución .NET

inputs:
  fail-on-severity:
    description: Severidad mínima que hace fallar dependency-review
    default: moderate
  check-format:
    description: Ejecutar dotnet format --verify-no-changes
    default: "true"
  dependency-review:
    description: Ejecutar dependency-review en pull requests
    default: "true"

runs:
  using: composite
  steps:
    - name: Propiedades que solo pueden definirse en Directory.Build.props
      shell: bash
      run: |
        if grep -rlE "<(TargetFramework|Nullable|LangVersion|TreatWarningsAsErrors)>" \
             --include=*.csproj .; then
          echo "::error::Common properties must be defined in Directory.Build.props"
          exit 1
        fi

    - name: Restore (bloqueado)
      shell: bash
      run: dotnet restore --locked-mode

    - name: Build
      shell: bash
      run: dotnet build --no-restore -c Release

    - name: Formato
      if: inputs.check-format == 'true'
      shell: bash
      run: dotnet format --verify-no-changes --no-restore

    - name: Paquetes vulnerables (incluye transitivos)
      shell: bash
      run: |
        dotnet list package --vulnerable --include-transitive --no-restore 2>&1 | tee report.txt
        if grep -q "has the following vulnerable packages" report.txt; then
          echo "::error::Vulnerable packages found"
          exit 1
        fi

    - name: Dependencias nuevas del PR
      if: inputs.dependency-review == 'true' && github.event_name == 'pull_request'
      uses: actions/dependency-review-action@v4
      with:
        fail-on-severity: ${{ inputs.fail-on-severity }}
```

Todo `run` de una composite action necesita `shell` explícito, y las condiciones de los pasos leen los inputs con `inputs.<nombre>`. Los inputs llegan siempre como texto, así que se comparan con `'true'`.

El workflow del repositorio queda en lo que cambia de un proyecto a otro: el checkout, el SDK y los tests.

```yaml
# .github/workflows/ci.yml
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

      - uses: ./.github/actions/dotnet-governance

      - run: dotnet test --no-build -c Release
```

Para añadirlo a un workflow que ya tienes, basta con insertar el `uses` después del checkout y del `setup-dotnet`. Si lo defines en un repositorio central, por ejemplo `contoso/platform-actions`, cada repositorio lo llama por ruta y versión:

```yaml
- uses: contoso/platform-actions/dotnet-governance@v1
  with:
    check-format: "false"   # mientras la solución no esté formateada
```

Dos cosas a tener en cuenta con el repositorio central:

- Fija siempre una etiqueta como `@v1`. Apuntar a una rama haría que cualquier cambio llegara a todos los repositorios sin que nadie lo revise.
- Si el repositorio central es privado, hay que permitir el acceso desde los demás en Settings > Actions > General > Access.

La composite action sirve además para el escalón de adopción gradual: los inputs permiten activar cada comprobación cuando el repositorio esté preparado, en lugar de editar un workflow por proyecto.

## Antes de poner todo en obligatorio

Si la solución ya tiene años, activar estos checks de golpe pone todos los PRs en rojo. Mantengo el orden de adopción del post de estándares de calidad:

1. Empieza con `check-format: "false"` y con warnings solo como avisos.
2. Abre un PR dedicado con el resultado de `dotnet format`, sin cambios de lógica, y activa entonces el formato.
3. Activa los pasos de vulnerabilidades y `dependency-review`, que suelen estar limpios o tienen un arreglo de una línea en `Directory.Packages.props`.
4. Marca el check como obligatorio en la protección de rama cuando lleven una semana en verde.
5. Añade `CODEOWNERS` el último, cuando el equipo de arquitectura sepa cuántas revisiones va a recibir.

## Cómo queda el repositorio

Con esto, la raíz del repositorio ya no solo describe las normas del equipo: un único workflow las comprueba en cada pull request y `CODEOWNERS` decide quién puede cambiarlas.

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
    ├── actions/
    │   └── dotnet-governance/action.yml
    └── workflows/
        ├── ci.yml
        └── outdated.yml
```
