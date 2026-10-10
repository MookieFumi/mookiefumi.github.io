#!/usr/bin/env bash
# Renderiza los diagramas Mermaid de diagrams/src a public/img/diagrams,
# en versión clara y oscura con los colores del blog.
#
# Uso: ./diagrams/render.sh            (todos)
#      ./diagrams/render.sh 02-auth-code-pkce   (uno)
set -euo pipefail

cd "$(dirname "$0")/.."
names=("$@")
if [ ${#names[@]} -eq 0 ]; then
  names=($(ls diagrams/src/*.mmd | xargs -n1 basename | sed 's/\.mmd$//'))
fi

for name in "${names[@]}"; do
  for theme in light dark; do
    npx -y @mermaid-js/mermaid-cli \
      -i "diagrams/src/${name}.mmd" \
      -o "public/img/diagrams/${name}-${theme}.svg" \
      -c "diagrams/theme-${theme}.json" \
      -p "diagrams/puppeteer-config.json" \
      -b transparent
  done
done
