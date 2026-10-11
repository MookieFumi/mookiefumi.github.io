---
title: "Hacer cumplir las normas y estándares de .NET con GitHub Actions"
subtitle: Un único workflow comprueba en cada pull request lo que definen Directory.Build.props, Central Package Management y el .editorconfig
date: 2026-09-16
topic: desarrollo
published: true
---

En los posts sobre gobernanza de soluciones .NET dejamos las normas en ficheros del repositorio: [Directory.Build.props](/2026-09-12-directory-build-props-contrato-calidad), [Central Package Management](/2026-09-13-central-package-management-nuget) y los [estándares de lenguaje y calidad](/2026-09-14-estandares-lenguaje-calidad-dotnet). Esos ficheros solo valen si algo comprueba que se cumplen en cada cambio. En un repositorio de GitHub ese algo es un workflow de Actions.

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

Y hay que haber generado y subido los `packages.lock.json` con un `dotnet restore` local desde `src/`. Sin esos ficheros, `--locked-mode` falla en el primer pull request.

## net-governance: todas las comprobaciones en un solo paso

Lo más caro de un workflow de .NET es todo lo que ocurre antes de comprobar nada: el checkout, la instalación del SDK y el restore. Cada job arranca en un runner limpio y lo repite, mientras que las comprobaciones en sí tardan segundos. Por eso van todas juntas, un paso por cada norma y con las baratas primero para que el PR falle cuanto antes, empaquetadas como un preset que se añade con una línea.

GitHub ofrece dos formas de empaquetarlo y se eligen según lo que quieras reutilizar:

| Opción | Se usa como | Cuándo encaja |
| --- | --- | --- |
| Composite action | Un paso (`uses:`) dentro de un job | Añadir las comprobaciones a un workflow existente, compartiendo su checkout y su SDK |
| Workflow reutilizable | Un job entero (`uses:` a nivel de job) | Imponer un pipeline completo, con su propio runner |

Aquí encaja la composite action, porque corre dentro del job del llamador y el checkout, el SDK y el restore se hacen una sola vez. Se llama `net-governance` y vive en un `action.yml`. GitHub exige que los workflows estén en `.github/workflows/`, pero una acción local puede estar en cualquier carpeta; `.github/actions/<nombre>/` es solo la convención habitual. El fichero de una acción siempre se llama `action.yml`, así que el nombre va en la carpeta:

```yaml
# .github/actions/net-governance/action.yml
name: net-governance
description: Checks the governance rules of a .NET solution

inputs:
  working-directory:
    description: Folder where the solution, Directory.Build.props and global.json live
    default: src
  solution:
    description: Solution or project to run dotnet against. Leave empty if there is only one in working-directory
    default: ""
  fail-on-severity:
    description: Minimum severity that makes dependency-review fail
    default: moderate
  check-format:
    description: Run dotnet format --verify-no-changes
    default: "true"
  dependency-review:
    description: Run dependency-review on pull requests
    default: "true"

runs:
  using: composite
  steps:
    - name: Properties that must only live in Directory.Build.props
      shell: bash
      working-directory: ${{ inputs.working-directory }}
      run: |
        if grep -rlE "<(TargetFramework|Nullable|LangVersion|TreatWarningsAsErrors)>" \
             --include=*.csproj .; then
          echo "::error::Common properties must be defined in Directory.Build.props"
          exit 1
        fi

    - name: Restore (locked)
      shell: bash
      working-directory: ${{ inputs.working-directory }}
      env:
        SOLUTION: ${{ inputs.solution }}
      run: dotnet restore $SOLUTION --locked-mode

    - name: Build
      shell: bash
      working-directory: ${{ inputs.working-directory }}
      env:
        SOLUTION: ${{ inputs.solution }}
      run: dotnet build $SOLUTION --no-restore -c Release

    - name: Format
      if: inputs.check-format == 'true'
      shell: bash
      working-directory: ${{ inputs.working-directory }}
      env:
        SOLUTION: ${{ inputs.solution }}
      run: dotnet format $SOLUTION --verify-no-changes --no-restore

    - name: Vulnerable packages (including transitive)
      shell: bash
      working-directory: ${{ inputs.working-directory }}
      env:
        SOLUTION: ${{ inputs.solution }}
      run: |
        dotnet list $SOLUTION package --vulnerable --include-transitive --no-restore 2>&1 | tee "$RUNNER_TEMP/vulnerable.txt"
        if grep -q "has the following vulnerable packages" "$RUNNER_TEMP/vulnerable.txt"; then
          echo "::error::Vulnerable packages found"
          exit 1
        fi

    - name: New dependencies in the PR
      if: inputs.dependency-review == 'true' && github.event_name == 'pull_request'
      uses: actions/dependency-review-action@v4
      with:
        fail-on-severity: ${{ inputs.fail-on-severity }}
```

Qué hace cada paso y de dónde sale:

- El primer paso es el `grep` que propusimos en el post de Directory.Build.props: falla si un `.csproj` redefine propiedades que deberían vivir en el fichero central. El prefijo `::error::` hace que el mensaje aparezca como anotación en el PR, no enterrado en el log. Mete aquí solo las propiedades que no admiten excepciones. Si un proyecto tiene una excepción documentada, mantén una lista de proyectos excluidos dentro del script en lugar de relajar la regla para todos.
- `--locked-mode` hace fallar el restore si alguna dependencia, transitivas incluidas, no coincide con el lock file. Es lo que garantiza que CI compila lo mismo que compilaste tú.
- El paso de build no lleva ningún flag de warnings. `Directory.Build.props` detecta la variable `GITHUB_ACTIONS` y activa `TreatWarningsAsErrors` solo en CI, tal como lo dejamos en el post de estándares de calidad. En local sigues trabajando con libertad y el PR no se puede fusionar con avisos.
- `dotnet format --verify-no-changes` termina con código distinto de cero si hay algo sin formatear. Cuando falla, el arreglo es ejecutar `dotnet format` en local y subir el resultado.
- `dotnet list package --vulnerable` devuelve siempre código 0, así que hay que leer su salida. Reutiliza el restore de antes con `--no-restore`. Detecta lo que ya está en la solución, así que también saltará cuando aparezca un aviso nuevo sobre un paquete que llevabas meses usando. Es lo que queremos, pero conviene avisar al equipo de que un PR ajeno puede ponerse rojo por eso.
- `dependency-review-action` compara el grafo de dependencias de la rama base con el del PR y falla si se añade algo con una vulnerabilidad de severidad moderada o superior. Señala el paquete que introduce el PR y no el estado general, por eso solo se ejecuta en pull requests. Necesita que el grafo de dependencias esté activo en el repositorio, y en repositorios privados requiere GitHub Advanced Security.

Con CPM activo no hace falta un paso para las versiones de paquetes: un `PackageReference` con `Version` ya rompe el build con `NU1008`, y uno sin su `PackageVersion` con `NU1010`.

Todo `run` de una composite action necesita `shell` explícito, y las condiciones de los pasos leen los inputs con `inputs.<nombre>`. Los inputs llegan siempre como texto, así que se comparan con `'true'`.

Lo que depende de cada repositorio entra como input con un valor por defecto razonable. `working-directory` es la carpeta donde viven la solución, `Directory.Build.props` y `global.json`. Vale `src` por defecto, porque ahí está el código, y todos los comandos de `dotnet` corren en esa carpeta, igual que en tu máquina. Si tu solución está en otro sitio, se cambia con `working-directory: otra/carpeta`. Si `solution` va vacío, `dotnet` busca el único `.sln` o proyecto de esa carpeta, y si hay varios falla con `MSB1011`. El `grep` recorre la carpeta de trabajo entera y encuentra solo todos los `.csproj`, así que no hace falta decirle dónde están. Los inputs se pasan a los scripts a través de `env` y no escribiendo `${{ inputs.x }}` dentro del `run`, para que un valor raro no pueda inyectar comandos en el shell.

El workflow de cada repositorio se queda con lo que el preset no puede adivinar: el checkout, el SDK y los tests.

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
          global-json-file: src/global.json
          cache: true
          cache-dependency-path: "**/packages.lock.json"

      - uses: ./.github/actions/net-governance

      - run: dotnet test --no-build -c Release
        working-directory: src
```

En este workflow, `cache-dependency-path` apunta a los lock files, así que la caché de NuGet se invalida solo cuando cambian las dependencias. `global-json-file` apunta al `global.json` de `src/` y evita repetir la versión del SDK; si no tienes uno, usa `dotnet-version: 10.0.x`. Los comandos de `run` que no pasan por el preset, como los tests, necesitan su propio `working-directory`. `concurrency` cancela la ejecución anterior de la misma rama cuando subes otro commit, que ahorra minutos en PRs con varios empujes seguidos.

Para añadir `net-governance` a un workflow que ya tienes, basta con insertar el `uses` después del checkout y del `setup-dotnet`.

Si lo defines en un repositorio central, por ejemplo `contoso/platform-actions`, cada repositorio lo llama por ruta y versión:

```yaml
- uses: contoso/platform-actions/net-governance@v1
  with:
    check-format: "false"   # until the solution is formatted
```

Dos cosas a tener en cuenta con el repositorio central:

- Fija siempre una etiqueta como `@v1`. Apuntar a una rama haría que cualquier cambio llegara a todos los repositorios sin que nadie lo revise.
- Si el repositorio central es privado, hay que permitir el acceso desde los demás en Settings > Actions > General > Access.

Separar en varios jobs solo compensa cuando una parte tarda de verdad, por ejemplo una batería de tests de varios minutos. Aun así, cada job extra paga otra vez el checkout y el restore, así que conviene medirlo antes.

## Quién revisa los cambios del estándar

Todo lo anterior comprueba el código. Quién puede cambiar las reglas lo controla `CODEOWNERS` junto con la protección de rama, no Actions.

`CODEOWNERS` es un fichero que asocia rutas del repositorio con las personas responsables de ellas. Cuando un PR toca un fichero con dueño, GitHub pide la revisión a ese dueño de forma automática. Si además la protección de rama exige la revisión de los code owners, el PR no se puede fusionar hasta que uno de ellos lo apruebe. Sirve para los ficheros de alto impacto: un cambio en `Directory.Build.props` o en `Directory.Packages.props` afecta a todos los proyectos a la vez y merece más atención que un cambio de negocio. El resto del código sigue su flujo normal.

El fichero reúne lo que fuimos listando en los tres posts:

```text
# .github/CODEOWNERS
/src/Directory.Build.props        @usuario1 @usuario2
/src/Directory.Build.targets      @usuario1 @usuario2
/src/tests/Directory.Build.props  @usuario1 @usuario2
/src/Directory.Packages.props     @usuario1 @usuario2
/src/nuget.config                 @usuario1 @usuario2
/src/.editorconfig                @usuario1 @usuario2
/src/global.json                  @usuario1 @usuario2
/.github/workflows/               @usuario1 @usuario2
/.github/actions/                 @usuario1 @usuario2
```

Las dos últimas líneas son las que más se olvidan. Si cualquiera puede editar los workflows, puede quitar los checks que acabamos de montar, así que `.github/workflows/` y `.github/actions/` también tienen que pasar por los dueños.

### A quién se puede asignar

Un dueño puede ser una persona (`@usuario`), un equipo de la organización (`@org/equipo`) o una dirección de correo asociada a una cuenta de GitHub. Se pueden poner varios en la misma línea y basta con que apruebe uno. Todos necesitan permiso de escritura en el repositorio, y si varias reglas del fichero coinciden con una ruta, manda la última que aparece.

Si lo que quieres es que revisen los mantenedores, hay un matiz. Maintain es un rol de repositorio que se concede a personas concretas, y `CODEOWNERS` no puede referirse a un rol. No existe una forma de escribir "todos los que tienen Maintain": hay que poner sus nombres de usuario, como en el ejemplo, y mantener la lista al día cuando cambie quién tiene el rol. Aunque tengan Maintain, quien no aparece en el fichero no recibe la petición de revisión.

Si prefieres no editar el fichero cada vez que cambia el grupo, en un repositorio de una organización puedes crear un equipo, por ejemplo `@contoso/maintainers`, darle permiso de escritura y poner el equipo en las reglas. Entonces cambiar quién revisa es cambiar los miembros del equipo. Los roles como Maintain están pensados para repositorios de organización; en un repositorio personal los colaboradores solo tienen acceso de escritura, y ahí se listan las personas.

## Antes de poner todo en obligatorio

Si la solución ya tiene años, activar estos checks de golpe pone todos los PRs en rojo. Mantengo el orden de adopción del post de estándares de calidad:

1. Empieza con `check-format: "false"` y con warnings solo como avisos.
2. Abre un PR dedicado con el resultado de `dotnet format`, sin cambios de lógica, y activa entonces el formato.
3. Activa los pasos de vulnerabilidades y `dependency-review`, que suelen estar limpios o tienen un arreglo de una línea en `Directory.Packages.props`.
4. Marca el check como obligatorio en la protección de rama cuando lleve una semana en verde.
5. Añade `CODEOWNERS` el último, cuando los mantenedores sepan cuántas revisiones van a recibir.

## Cómo queda el repositorio

Así queda la parte de gobernanza del repositorio. Los ficheros de `src/` describen las normas, un único workflow las comprueba en cada pull request y `CODEOWNERS` decide quién puede cambiarlas.

```text
repo/
├── .github/
│   ├── CODEOWNERS
│   ├── dependabot.yml
│   ├── actions/
│   │   └── net-governance/action.yml
│   └── workflows/
│       └── ci.yml
└── src/
    ├── Payments.sln
    ├── Directory.Build.props
    ├── Directory.Packages.props
    ├── nuget.config
    ├── .editorconfig
    ├── global.json
    ├── Payments.Api/
    ├── Payments.Domain/
    └── tests/
        ├── Directory.Build.props
        └── Payments.Api.Tests/
```

Con todo dentro de `src/`, `dependabot.yml` también tiene que apuntar ahí: en su entrada de `nuget`, `directory: "/src"` en lugar de `"/"`.
