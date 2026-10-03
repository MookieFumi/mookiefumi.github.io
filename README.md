# Csharpeando#

Blog de Miguel Ángel Martín Hernández sobre .NET, IA, despliegues y equipos. Se publica en [mookiefumi.com](https://mookiefumi.com) con GitHub Pages.

## Ejecutar en local

Necesitas Ruby 3 y Bundler.

```bash
bundle install
bundle exec jekyll serve
```

El blog queda en `http://localhost:4000`.

## Escribir un post

Crea un fichero en `_posts/` con el nombre `AAAA-MM-DD-slug.md`. La fecha del nombre es la del post y forma parte de la URL (`/AAAA-MM-DD-slug`).

```yaml
---
layout: post
title: Título del post
subtitle: Una línea que lo resume (opcional)
topic: ia
published: true
---
```

`topic` decide el color de la portada y en qué sección de `/temas` aparece el post. Los temas disponibles están en `_data/topics.yml`. Para añadir uno nuevo:

1. Añádelo a `_data/topics.yml`.
2. Define `--topic-<slug>-fill` y `--topic-<slug>-text` en `css/tokens.css`, también en los dos bloques del modo oscuro.
3. Añade la clase `.topic-<slug>` en `css/site.css`, junto a las demás.

## Diagramas

Los diagramas se escriben en Mermaid pero se publican como SVG, en versión clara y oscura, para no cargar ninguna librería en el navegador.

1. Escribe el diagrama en `_diagrams/src/<nombre>.mmd`.
2. Ejecuta `./_diagrams/render.sh <nombre>` (necesita Node.js). Genera `img/diagrams/<nombre>-light.svg` y `img/diagrams/<nombre>-dark.svg`.
3. Inclúyelo en el post:

```html
<figure class="diagram">
  <img class="diagram-light" src="{{ '/img/diagrams/<nombre>-light.svg' | prepend: site.baseurl }}" alt="Descripción del diagrama">
  <img class="diagram-dark" src="{{ '/img/diagrams/<nombre>-dark.svg' | prepend: site.baseurl }}" alt="Descripción del diagrama">
</figure>
```

## Estructura

| Ruta | Contenido |
| --- | --- |
| `_posts/` | Los artículos |
| `_layouts/`, `_includes/` | Plantillas del sitio |
| `_data/topics.yml` | Temas de los posts |
| `_diagrams/` | Fuentes Mermaid, temas de color y script de renderizado |
| `css/tokens.css` | Colores y tipografías (modo claro y oscuro) |
| `css/site.css`, `css/syntax.css` | Estilos del sitio y del resaltado de código |
| `js/site.js` | Modo oscuro y botón de copiar código |
| `img/brand/` | Logo y favicon |

## Configuración

En `_config.yml`:

- `cloudflare_analytics_token`: analítica con Cloudflare Web Analytics (sin cookies).
- `disqus`: comentarios de los posts.
- `navbar-links`, `author`, `footer-links-active`: enlaces de la barra y del pie.

## Licencia

El diseño original partía de [beautiful-jekyll](https://github.com/daattali/beautiful-jekyll), con licencia MIT (ver `LICENSE`).
