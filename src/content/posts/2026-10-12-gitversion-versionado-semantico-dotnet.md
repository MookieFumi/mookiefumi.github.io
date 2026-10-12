---
title: "GitVersion: que la versión la calcule el historial de git"
subtitle: Qué te da, qué te cuesta y cómo configurarlo según uses git flow, github flow o trunk based development
date: 2026-10-12
topic: dotnet
published: true
---

En el post sobre [Directory.Build.props](/2026-09-12-directory-build-props-contrato-calidad) dejé la versión en una sola propiedad y prometí volver con una forma de calcularla sin tocar ningún fichero. Esa forma es [GitVersion](https://gitversion.net): una herramienta que lee el historial de git, mira los tags, la rama en la que estás y los mensajes de los commits, y devuelve un número de [versionado semántico](/2016-11-28-entendiendo-semantic-versioning).

La idea es que nadie edite un `<Version>` a mano. Si dos personas tocan esa línea en ramas distintas, el conflicto está servido, y si nadie la toca, acabas publicando tres paquetes distintos con la `1.0.0`.

## Cómo calcula la versión

GitVersion parte del último tag de versión alcanzable desde tu commit y decide cuánto incrementar según tres cosas:

- La rama: cada tipo de rama (`main`, `feature/*`, `release/*`...) tiene su propia regla: qué incremento aplica, qué etiqueta de pre-release lleva y si cada commit genera versión nueva.
- Los commits desde el último tag: por defecto entiende marcas como `+semver: minor` o `+semver: breaking` en el mensaje.
- Un `next-version` opcional en la configuración, para forzar el salto cuando lo necesitas (por ejemplo, empezar la `2.0.0`).

Con un tag `1.4.0` en `main` y tres commits después, la salida es parecida a esta:

| Dónde estás | Resultado (ejemplo) |
| --- | --- |
| `main`, sobre el tag `1.4.0` | `1.4.0` |
| `main`, tres commits después | Algo como `1.4.1`, según el modo de la rama |
| `feature/cancel-orders` | `1.4.1-cancel-orders.3` |
| PR número 42 | `1.4.1-PullRequest0042.3` |

La rama y el modo cambian los detalles, así que no te fíes de esta tabla al milímetro. La versión sale del repositorio. Para ver la tuya en local, ejecuta `dotnet gitversion`.

## Usarlo en un proyecto .NET

La herramienta se instala como tool local, igual que Husky en el [post de commits convencionales](/2026-09-19-commits-convencionales-dotnet):

```bash
dotnet new tool-manifest
dotnet tool install GitVersion.Tool
dotnet gitversion /showvariable FullSemVer
```

En CI hay una condición que no es negociable: el checkout tiene que traerse todo el historial y los tags. Con el `fetch-depth: 1` por defecto de `actions/checkout`, GitVersion no encuentra ningún tag y te devuelve `0.1.0` o falla.

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0

- run: dotnet tool restore

- name: Compute version
  id: version
  run: echo "semver=$(dotnet gitversion /showvariable FullSemVer)" >> "$GITHUB_OUTPUT"

- run: dotnet build -c Release -p:Version=${{ steps.version.outputs.semver }}
```

Desde ahí le pasas la versión a `dotnet build` y `dotnet pack`. Si prefieres no escribir ese paso, el paquete NuGet `GitVersion.MsBuild` calcula la versión en el propio build y rellena `Version`, `AssemblyVersion` e `InformationalVersion`. Ojo con mezclarlo con una `<Version>` fija en `Directory.Build.props`: una de las dos tiene que desaparecer.

## Beneficios

- Una sola fuente de verdad: mandan el tag y el historial, y ningún número del `.csproj` se queda desfasado.
- Cada commit tiene una versión distinta, así que un paquete de preview de una rama no pisa al de otra.
- Dado un paquete en el feed, sabes de qué rama y de qué commit salió.
- Si ya usas Conventional Commits, el tipo del commit decide el incremento y el versionado deja de ser una discusión en el PR.
- Lo único manual es crear el tag cuando publicas una versión estable.

## Contras

- Depende del historial completo. Un clon superficial o un agente de CI que no trae los tags dan versiones raras. Lo peor es que el build no rompe: solo sale con la versión equivocada.
- La versión deja de estar en el código. Alguien que abra el repo no sabe en qué versión está sin ejecutar la herramienta.
- Hay curva de aprendizaje: modos de despliegue, etiquetas de pre-release, pesos, ramas fuente... La configuración por defecto sirve para empezar, pero entender por qué una rama da cierta versión exige leer la documentación.
- Cambia entre versiones mayores. Pasar de la 5 a la 6 obligó a renombrar claves, y la 7 en desarrollo cambia la estructura del fichero. Fija la versión de la herramienta en el manifiesto y actualízala con tiempo.
- Genera ruido de pre-release. Si cada rama y cada PR generan su versión, tu feed de paquetes se llena. Conviene una política de limpieza.
- Penaliza el historial desordenado: ramas con nombres que no encajan en los patrones, merges raros o tags borrados a mano producen resultados que cuesta explicar.

Si lo único que quieres es "el último tag más el número de commits", [MinVer](https://github.com/adamralph/minver) es más simple y tiene menos que configurar. GitVersion compensa cuando necesitas reglas distintas por rama.

## Cómo encaja con cada flujo de git

GitVersion trae un preset por flujo. Se activa con una línea en `GitVersion.yml`, y desde ahí sobrescribes solo lo que te haga falta:

| | Git flow | GitHub flow | Trunk based |
| --- | --- | --- | --- |
| Ramas | `main`, `develop`, `feature/*`, `release/*`, `hotfix/*` | `main` y ramas cortas por cambio | `main` y ramas muy cortas, o commits directos |
| Preset | `GitFlow/v1` | `GitHubFlow/v1` | `TrunkBased/preview1` (experimental) |
| Versión en `develop` | Pre-release `alpha` | No existe `develop` | No existe `develop` |
| Versión en `release/*` | Pre-release `beta` | `beta`, si usas ramas de release | No hay ramas de release |
| Versión estable | Al hacer merge a `main` y poner el tag | Tag sobre `main` | Cada commit en `main` genera versión |
| Encaje | Muy bueno, es para lo que nació | Bueno, el más fácil de configurar | Útil, pero el preset aún es preview |

### Git flow

Es donde GitVersion rinde más. El preset conoce `develop` (pre-release `alpha`), `release/*` (`beta`) y `hotfix/*`, y la rama `release/1.5.0` fija el número de versión sola. Con el preset casi no hay nada que escribir:

```yaml
workflow: GitFlow/v1
```

Lo habitual es retocar poco. Por ejemplo, que `develop` use otra etiqueta:

```yaml
workflow: GitFlow/v1
branches:
  develop:
    label: preview
```

El coste es el propio git flow: más ramas, más merges y más sitios donde una versión puede salir inesperada.

### GitHub flow

Con `main` siempre desplegable y una rama corta por cambio, el trabajo de GitVersion es más pequeño. Las ramas de feature y los PR llevan su etiqueta y `main` va subiendo versiones estables al poner el tag.

```yaml
workflow: GitHubFlow/v1
```

Si quieres que cada merge a `main` publique una versión sin esperar al tag, cambia el modo de despliegue de esa rama:

```yaml
workflow: GitHubFlow/v1
branches:
  main:
    mode: ContinuousDeployment
```

Es la combinación más sencilla para equipos pequeños con paquetes internos.

### Trunk based development

El preset `TrunkBased/preview1` es experimental, y su comportamiento puede cambiar entre versiones. Conviene probarlo contra un historial real de tu repo antes de adoptarlo. La idea es que `main` use `ContinuousDeployment`, de forma que cada commit tenga una versión única y estable, sin sufijo, y las ramas cortas lleven el nombre de la rama como etiqueta.

```yaml
workflow: TrunkBased/preview1
```

Como en este flujo el código sin terminar entra a `main` detrás de feature flags, la versión no dice qué funcionalidades están activas. Eso se resuelve con la configuración del producto, no con GitVersion.

Con squash merge, que es lo que suele acompañar a este flujo, entra en juego lo que contaba en el post de commits: lo que queda en `main` es el título del PR. Si ese título sigue Conventional Commits, el incremento de versión sale bien. Si no, GitVersion no se entera.

## Conectarlo con Conventional Commits

Es fácil suponer lo contrario, pero GitVersion no interpreta Conventional Commits de serie. Por defecto solo busca marcas del tipo `+semver: minor`. Para que `feat:` suba el minor y `fix:` el patch, hay que decírselo con expresiones regulares:

```yaml
workflow: GitHubFlow/v1
major-version-bump-message: '^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([\w\s-,/\\]*\))?(!:|:.*\n\n((.+\n)+\n)?BREAKING CHANGE:\s.+)'
minor-version-bump-message: '^(feat)(\([\w\s-,/\\]*\))?:'
patch-version-bump-message: '^(fix|perf)(\([\w\s-,/\\]*\))?:'
```

Son las que propone la propia documentación de GitVersion. Con ellas, estos commits se traducen así:

```text
fix(auth): fix refresh token expiration        -> patch
feat(orders): add endpoint to cancel orders    -> minor
refactor(infrastructure)!: change the EF Core  -> major
```

La regex de validación del post de commits y estas tienen que ser coherentes: si el hook acepta un tipo que GitVersion no reconoce, el commit pasa el check pero no incrementa nada.

## Cuándo lo usaría y cuándo no

Lo usaría si publicas paquetes NuGet o varios servicios con versiones que importan, si tienes más de una persona integrando en paralelo y si ya tienes disciplina con los mensajes de commit.

Lo evitaría en una app que nadie versiona de verdad, o en un repo donde el CI hace clones superficiales y no puedes cambiarlo. En esos casos, un `<Version>` en `Directory.Build.props` y un tag manual salen más baratos.

Si decides probarlo, empieza por el preset de tu flujo, ejecuta `dotnet gitversion` en local sobre un par de ramas y comprueba que los números te cuadran antes de llevarlo al pipeline. Encaja bien junto al [workflow de gobernanza .NET](/2026-09-16-hacer-cumplir-normas-dotnet-github-actions), como un paso más que se calcula antes del build.
