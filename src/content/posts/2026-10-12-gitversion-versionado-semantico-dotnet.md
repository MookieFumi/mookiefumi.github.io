---
title: "Versionado automático en .NET con GitVersion según tu flujo de git"
subtitle: Qué te da, qué te cuesta y qué preset usar con git flow, github flow o trunk based development
date: 2026-10-12
topic: dotnet
published: true
---

En el post sobre [Directory.Build.props](/2026-09-12-directory-build-props-contrato-calidad) dejé la versión en una sola propiedad y prometí volver con una forma de calcularla sin tocar ningún fichero. [GitVersion](https://gitversion.net) lee el historial de git (los tags, la rama y los mensajes de los commits) y devuelve un número de [versionado semántico](/2016-11-28-entendiendo-semantic-versioning). Así nadie edita un `<Version>` a mano ni publica tres paquetes distintos con la `1.0.0`.

## Cómo se usa

Parte del último tag de versión y suma según la rama y los commits que vienen detrás. Con un tag `1.4.0` en `main`, una rama `feature/cancel-orders` con tres commits da algo como `1.4.1-cancel-orders.3`.

Se instala como tool local:

```bash
dotnet new tool-manifest
dotnet tool install GitVersion.Tool
dotnet gitversion /showvariable FullSemVer
```

En CI el checkout tiene que traer todo el historial (`fetch-depth: 0` en `actions/checkout`). Con el clon superficial por defecto no encuentra los tags y la versión sale mal sin que el build falle. Después le pasas el resultado a `dotnet build` o `dotnet pack` con `-p:Version=...`, o usas el paquete `GitVersion.MsBuild`, que lo hace en el propio build. En ese caso quita la `<Version>` fija de `Directory.Build.props`.

## Lo bueno y lo malo

A favor:

- La versión sale del tag y del historial, así que ningún `.csproj` se queda desfasado.
- Cada commit tiene una versión distinta y cualquier paquete se puede rastrear hasta su rama y su commit.
- Lo único manual es crear el tag de una versión estable.

En contra:

- Depende del historial completo. Un clon superficial da versiones raras.
- La versión no está en el código. Para saberla hay que ejecutar la herramienta.
- La configuración tiene curva de aprendizaje y cambia entre versiones mayores (de la 5 a la 6 se renombraron claves). Fija la versión del tool en el manifiesto.
- Cada rama y cada PR generan su pre-release, y el feed de paquetes se llena.

Si te basta con "último tag más número de commits", [MinVer](https://github.com/adamralph/minver) es más simple. GitVersion compensa cuando quieres reglas distintas por rama.

## Qué preset usar según tu flujo

GitVersion trae un preset por flujo. Se elige con una línea en `GitVersion.yml`:

| Flujo | Preset | Cómo versiona |
| --- | --- | --- |
| Git flow | `workflow: GitFlow/v1` | `develop` da pre-releases `alpha`, `release/*` da `beta` y la versión estable sale al hacer merge a `main` con su tag. Es el flujo para el que nació. |
| GitHub flow | `workflow: GitHubFlow/v1` | Las ramas y los PR llevan su etiqueta y `main` sube versión estable al poner el tag. Es el más fácil de configurar. |
| Trunk based | `workflow: TrunkBased/preview1` | Cada commit en `main` genera versión. El preset es experimental, así que pruébalo contra un historial real antes de adoptarlo. |

En GitHub flow, si quieres que cada merge a `main` tenga versión estable sin esperar al tag, añade:

```yaml
workflow: GitHubFlow/v1
branches:
  main:
    mode: ContinuousDeployment
```

## Con Conventional Commits

GitVersion no entiende Conventional Commits de serie: solo busca marcas como `+semver: minor`. Para que `feat:` suba el minor, `fix:` el patch y `!` el major, añade las expresiones que propone su documentación:

```yaml
major-version-bump-message: '^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([\w\s-,/\\]*\))?(!:|:.*\n\n((.+\n)+\n)?BREAKING CHANGE:\s.+)'
minor-version-bump-message: '^(feat)(\([\w\s-,/\\]*\))?:'
patch-version-bump-message: '^(fix|perf)(\([\w\s-,/\\]*\))?:'
```

Con squash merge, el título del PR es el commit que llega a `main`, y el [check del título del PR](/2026-09-19-commits-convencionales-dotnet) garantiza que siga el formato. Mantén coherentes esa regex y estas.

## De la versión a la release

Un paso en el workflow de `main` publica la release. Necesita `permissions: contents: write` y la variable `GH_TOKEN`:

```bash
VERSION=$(dotnet gitversion /showvariable MajorMinorPatch)
gh release create "v$VERSION" --target "$GITHUB_SHA" --generate-notes
```

`gh release create` crea el tag y la release, y ese tag es el punto de partida de la siguiente versión. Así cada push a `main` publica una release; si prefieres decidir cuándo, lanza el workflow a mano con `workflow_dispatch`. Las notas que genera GitHub salen de los PR mergeados desde la release anterior, agrupados por etiquetas si defines categorías en `.github/release.yml`. Para agrupar por `feat` y `fix` hacen falta herramientas como release-please o git-cliff, pero también calculan la versión y compiten con GitVersion.

Si publicas paquetes NuGet o varios servicios, y tu equipo ya cuida los mensajes de commit, merece la pena. En una app que nadie versiona de verdad, un `<Version>` en `Directory.Build.props` y un tag manual salen más baratos.
