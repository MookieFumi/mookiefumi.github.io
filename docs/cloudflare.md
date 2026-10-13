# Caché y redirecciones con Cloudflare

GitHub Pages no permite configurar cabeceras de caché ni devolver redirecciones 301: sirve todo con `Cache-Control: max-age=600` y las redirecciones de `astro.config.mjs` son páginas HTML con `<meta http-equiv="refresh">`. Google las acaba siguiendo, pero un 301 real es más fiable y transmite mejor la autoridad de la URL antigua.

Para tener ambas cosas, el dominio tiene que pasar por Cloudflare (registros DNS con la nube naranja, «Proxied»). Todo lo de este documento se configura en el panel de Cloudflare, no en el repositorio, y no hace nada mientras el dominio no esté detrás del proxy.

Comprueba si lo está:

```bash
curl -sI https://mookiefumi.com | grep -i -E 'cf-ray|server'
```

Si aparece `cf-ray` y `server: cloudflare`, está detrás del proxy. Si no, hay que activar el proxy en **DNS → Records** antes de seguir.

## 1. Reglas de caché

En **Caching → Cache Rules → Create rule**. Crea estas dos, en este orden.

### `/_astro/*`: un año, inmutable

Desde que CSS, JavaScript y fuentes salen empaquetados por Astro, su nombre lleva un hash del contenido (`Base.Be8E0LfQ.css`). Si el contenido cambia, cambia el nombre, así que puede cachearse sin caducidad.

- **When incoming requests match:** `URI Path` `starts with` `/_astro/`
- **Cache eligibility:** Eligible for cache
- **Edge TTL:** Ignore cache-control header and use this TTL → 1 year
- **Browser TTL:** Override origin and use this TTL → 1 year

### Imágenes y resto de estáticos: un mes en el borde

`/images/`, `/img/` y `/js/` no llevan hash, así que no se cachean un año en el navegador: si sustituyes una imagen sin cambiar su nombre, no quieres que nadie vea la vieja durante meses.

- **When incoming requests match:** `URI Path` `starts with` `/images/` **o** `/img/` **o** `/js/`
- **Cache eligibility:** Eligible for cache
- **Edge TTL:** Ignore cache-control header and use this TTL → 1 month
- **Browser TTL:** Override origin and use this TTL → 1 day

### El HTML se deja como está

Cloudflare no cachea HTML por defecto y GitHub Pages ya lo sirve con diez minutos de caché. Cachear páginas en el borde obligaría a purgar tras cada publicación y el beneficio es pequeño en un sitio estático.

## 2. Redirecciones 301

En **Rules → Redirect Rules → Create rule**, con plantilla «Custom filter expression» y tipo **Static** (o **Dynamic** donde se indica). Código de estado **301**. Activa **Preserve query string**.

| Origen | Destino |
| --- | --- |
| `/temas` | `/topics` |
| `/recursos` | `/resources` |
| `/2019-10-20-unit-testing-tools-using-your-MacOS-terminal` | `/2019-10-20-unit-testing-tools-using-your-macos-terminal` |

Son las mismas tres redirecciones que declara `astro.config.mjs`. Se mantienen allí como red de seguridad, por si el dominio dejara de pasar por Cloudflare. Para cada una, la expresión es:

```
(http.host eq "mookiefumi.com" and http.request.uri.path eq "/temas")
```

con destino estático `https://mookiefumi.com/topics`.

### Quitar `.html` de las URL (opcional, recomendado)

Con `build.format: 'preserve'`, cada post existe como `/slug.html` y como `/slug`. El canonical ya apunta a la versión limpia, pero un 301 evita el duplicado del todo. Usa una regla con comodín:

- **Request URL:** `https://mookiefumi.com/*.html`
- **Target URL:** `https://mookiefumi.com/${1}`
- **Status:** 301

Pon antes otra regla que mande `/index.html` a `/`, para que la portada no acabe en `/index`.

### `www` hacia el dominio sin `www` (solo si existe el registro)

Si `www.mookiefumi.com` resuelve, redirígelo al dominio principal:

- **Request URL:** `https://www.mookiefumi.com/*`
- **Target URL:** `https://mookiefumi.com/${1}`
- **Status:** 301

## 3. Comprobar que funciona

```bash
# Caché de los estáticos con hash
curl -sI https://mookiefumi.com/_astro/<fichero-con-hash>.css | grep -i -E 'cache-control|cf-cache-status'
# debe decir max-age=31536000 y, a la segunda petición, cf-cache-status: HIT

# Redirecciones
curl -sI https://mookiefumi.com/temas | grep -i -E '^HTTP|location'
# debe decir 301 y location: https://mookiefumi.com/topics
```

Después, en Search Console, usa **Inspección de URLs** sobre `/temas`: debe indicar que redirige.

## Mantenimiento

- Si renombras un post, añade su redirección 301 aquí (y en `astro.config.mjs`). Mejor no renombrar: ver el README.
- Si cambias el nombre de una carpeta de `public/` que tiene regla de caché, actualiza la regla.
