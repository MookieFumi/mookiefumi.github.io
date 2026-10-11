---
title: "Conventional Commits en .NET sin fiarte de que el dev se acuerde"
subtitle: Por qué un hook local no basta y cómo combinar un hook versionado que se instala con el build con un check obligatorio en el PR
date: 2026-09-18
topic: desarrollo
published: false
---

Muchos equipos acaban usando [Conventional Commits](https://www.conventionalcommits.org): `tipo(ámbito): descripción`, con tipos como `feat`, `fix`, `docs`, `refactor`, `test` o `chore`, y `!` o `BREAKING CHANGE:` cuando rompes algo. No es la única opción (hay equipos que usan el número del ticket, `JIRA-123: ...`, o su propio prefijo), pero es la que más herramientas entiende: changelogs automáticos, versionado semántico y un historial que se lee de un vistazo.

El ámbito es opcional y va entre paréntesis: indica qué parte del código toca el cambio, normalmente un módulo, un proyecto o una capa. En una solución .NET puede ser el nombre del proyecto o del área:

```text
feat(orders): add endpoint to cancel orders
fix(auth): fix refresh token expiration
refactor(infrastructure)!: change the EF Core base repository
```

Si el cambio no encaja en un ámbito concreto, lo omites (`docs: update the README`). Conviene acordar en el equipo la lista de ámbitos, o al menos que sean nombres de proyecto, para que no aparezcan tres variantes del mismo.

Elegir el formato lleva cinco minutos. Conseguir que se cumpla en todos los clones del repo es más complicado.

## Por qué falla el hook que solo vive en tu máquina

Yo lo intenté con un `commit-msg` en una carpeta que no era la de por defecto. Funcionaba en mi clon y en ningún otro, y si cada dev tiene que acordarse de activarlo, la regla acaba siendo opcional. Tres motivos:

- `.git/hooks` no se versiona y no viaja con el `git clone`.
- Una carpeta propia, por ejemplo `.githooks`, se puede versionar, pero Git solo la usa si cada dev ejecuta `git config core.hooksPath .githooks`. Esa config es local.
- Aunque el hook esté activo, `git commit --no-verify` lo salta, y algunos clientes gráficos ni lo ejecutan.

## Capa 1: el hook viaja con el repo y se activa solo

Guarda el hook en el repo y haz que el build lo enchufe. Con [Husky.Net](https://alirezanet.github.io/Husky.Net/) queda así:

```bash
dotnet new tool-manifest
dotnet tool install Husky
dotnet husky install
dotnet husky add .husky/commit-msg -c 'dotnet husky run --name commit-msg --args "$1"'
```

Para que nadie tenga que ejecutar nada, un target en `src/Directory.Build.targets` o en el proyecto que quieras prepara Husky en cada restore:

```xml
<Target Name="Husky" BeforeTargets="Restore;CollectPackageReferences"
        Condition="'$(HUSKY)' != '0' And '$(CI)' != 'true' And '$(Configuration)' != 'Release' And Exists('$(MSBuildThisFileDirectory)../.git')">
  <Exec Command="dotnet tool restore" StandardOutputImportance="Low" StandardErrorImportance="High" />
  <Exec Command="dotnet husky install" WorkingDirectory="$(MSBuildThisFileDirectory).." StandardOutputImportance="Low" StandardErrorImportance="High" />
</Target>
```

El target no se ejecuta en CI (variable `CI`), ni con `-c Release`, ni si defines `HUSKY=0`: los hooks solo tienen sentido en la máquina de quien hace commits, no en un build de release ni en un agente de CI. El dev clona, compila o restaura en Debug y `core.hooksPath` queda apuntando a `.husky`. Sin pasos extra en el README.

## Capa 2: qué valida el hook

En `.husky/task-runner.json` puedes validar el mensaje con una expresión regular, sin depender de Node:

```json
{
  "tasks": [
    {
      "name": "commit-msg",
      "command": "bash",
      "args": [
        "-c",
        "grep -qE '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\\([a-z0-9-]+\\))?!?: .{1,72}$' \"$1\" || { echo 'Use Conventional Commits: type(scope): description'; exit 1; }",
        "--",
        "${args}"
      ]
    }
  ]
}
```

Si ya usas Node en el repo, [commitlint](https://commitlint.js.org) con `@commitlint/config-conventional` hace lo mismo con reglas más completas.

## Capa 3: la red que no se salta

Lo anterior avisa pronto y en local, pero un hook se puede saltar. Un check obligatorio de la rama protegida no, así que la garantía tiene que estar en el servidor. Un workflow de un solo paso, sin acciones de terceros, puede validar el título del PR:

```yaml
name: PR title
on:
  pull_request:
    types: [opened, edited, synchronize, reopened]
jobs:
  title:
    runs-on: ubuntu-latest
    steps:
      - name: Check Conventional Commits title
        env:
          PR_TITLE: ${{ github.event.pull_request.title }}
        run: |
          echo "$PR_TITLE" | grep -qE '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9-]+\))?!?: .{1,72}$' \
            || { echo "::error::PR title must follow Conventional Commits: $PR_TITLE"; exit 1; }
```

No hace falta `actions/checkout`, porque el título viaja en el evento del PR y no se lee ningún fichero del repo. El título pasa por una variable de entorno y no se interpola dentro del script, para que un título con comillas o `$(...)` no ejecute nada. La regex es la misma que la del hook: si cambias una, cambia la otra.

Después, en la protección de rama, marca este job como check obligatorio y activa **Squash merge** con "Default to pull request title". Con squash, lo que queda en `main` es el título del PR. Los commits intermedios de la rama pueden ser un desastre, porque el historial de `main` seguirá cumpliendo el formato. Este check encaja junto al resto de comprobaciones del [workflow de gobernanza .NET](/2026-09-16-hacer-cumplir-normas-dotnet-github-actions).

Si tu organización tiene GitHub Enterprise, hay otra vía sin workflow: un ruleset sobre `main` con la regla de metadatos de commit ("Restrict commit metadata" y "Must match a given regex pattern"), con la misma regex. Comprueba que tu plan la incluye antes de apoyarte en ella.
