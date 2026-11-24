# Caché y redirecciones con Cloudflare

GitHub Pages no permite configurar cabeceras de caché ni devolver redirecciones 301: sirve todo con `Cache-Control: max-age=600` y las redirecciones de `astro.config.mjs` son páginas HTML con `<meta http-equiv="refresh">`. Google las acaba siguiendo, pero un 301 real es más fiable y transmite mejor la autoridad de la URL antigua.

Para tener ambas cosas, el dominio pasa por Cloudflare (registros DNS con la nube naranja, «Proxied»). Todo lo de este documento se configura en el panel de Cloudflare, no en el repositorio.

## Estado: aplicado y verificado el 2026-11-24

Todas las reglas están creadas en el panel. Se comprobaron con `curl` contra producción el 2026-11-24, entre las 21:22 y las 21:38 (hora de Madrid), y se repitieron a las 21:38.

| Paso | Qué se comprobó | Resultado | Estado |
| --- | --- | --- | --- |
| Proxy | `curl -sI https://mookiefumi.com` muestra `server: cloudflare` y `cf-ray` | Detrás del proxy | Confirmado |
| Caché `/_astro/*` | `/_astro/Base.DpvRQtPz.css` | `cache-control: max-age=31536000`; segunda petición con `cf-cache-status: HIT` | Confirmado |
| Caché imágenes | `/img/brand/mookie-og.png` | `cache-control: max-age=86400` | Confirmado |
| HTML | `/` | `max-age=600` (sin cambios, es lo previsto) | Confirmado |
| 301 `/temas` | `curl -sI` y con User-Agent de Googlebot | `301` a `https://mookiefumi.com/topics` | Confirmado |
| 301 `/recursos` | `curl -sI` | `301` a `https://mookiefumi.com/resources` | Confirmado |
| 301 slug MacOS | `curl -sI` | `301` a `.../2019-10-20-unit-testing-tools-using-your-macos-terminal` | Confirmado |
| 301 `/index.html` | `curl -sI` | `301` a `https://mookiefumi.com/` | Confirmado |
| `www` | `curl -sI https://www.mookiefumi.com/` | `301` a `https://mookiefumi.com/` | Confirmado (ya redirigía) |
| `.html` | `/topics.html` | `404`, no hay duplicado que redirigir | No necesaria |
| Search Console, prueba en vivo | Inspección de URLs sobre `/temas` | Google la ve disponible porque sigue la redirección | Confirmado (2026-11-24) |
| Search Console, informe «Página con redirección» | `/temas` | Aún no aparece | Pendiente |
| Sitemap | `sitemap-index.xml` enviado a Google y a Bing | Enviado el 2026-11-24 | Confirmado |

## 1. Reglas de caché

En **Rules → Overview → Create rule → Cache Rule**. Crea estas dos, en este orden.

### `/_astro/*`: un año, inmutable

Desde que CSS, JavaScript y fuentes salen empaquetados por Astro, su nombre lleva un hash del contenido (`Base.DpvRQtPz.css`). Si el contenido cambia, cambia el nombre, así que puede cachearse sin caducidad.

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

En **Rules → Overview → Create rule → Redirect Rule**, con plantilla «Custom filter expression» y tipo **Static**. Código de estado **301**. Activa **Preserve query string**.

| Origen | Destino |
| --- | --- |
| `/temas` | `/topics` |
| `/recursos` | `/resources` |
| `/2019-10-20-unit-testing-tools-using-your-MacOS-terminal` | `/2019-10-20-unit-testing-tools-using-your-macos-terminal` |
| `/index.html` | `/` |

Las tres primeras son las mismas redirecciones que declara `astro.config.mjs`. Se mantienen allí como red de seguridad, por si el dominio dejara de pasar por Cloudflare. Para cada una, la expresión es:

```
(http.host eq "mookiefumi.com" and http.request.uri.path eq "/temas")
```

con destino estático `https://mookiefumi.com/topics`.

### `index-html-to-root`

Regla añadida al aplicar el documento, para que la portada no tenga dos URL: Hostname `mookiefumi.com` **y** URI Path `equals` `/index.html`, con 301 a `https://mookiefumi.com/`.

### `www` hacia el dominio sin `www`

`www.mookiefumi.com` ya respondía con un 301 al dominio sin `www` antes de crear ninguna regla, así que no hay nada que configurar. La comprobación está en la tabla de estado.

### Quitar `.html` de las URL: no necesario

Se planteó una regla con comodín (`https://mookiefumi.com/*.html` → `https://mookiefumi.com/${1}`), pero `https://mookiefumi.com/topics.html` devuelve 404, así que no hay versión duplicada con `.html` que redirigir. No se ha creado. Si en el futuro alguna URL con `.html` se sirviera con 200, habría que reconsiderarlo, siempre con `/index.html` resuelta antes.

## 3. Comprobar que funciona

```bash
# Caché de los estáticos con hash
curl -sI https://mookiefumi.com/_astro/<fichero-con-hash>.css | grep -i -E 'cache-control|cf-cache-status'
# debe decir max-age=31536000 y, a la segunda petición, cf-cache-status: HIT

# Redirecciones
curl -sI https://mookiefumi.com/temas | grep -i -E '^HTTP|location'
# debe decir 301 y location: https://mookiefumi.com/topics
```

Después, en Search Console, usa **Inspección de URLs** sobre `/temas`: debe indicar que redirige. El informe «Página con redirección» tarda en reflejarlo.

## Mantenimiento

- Si renombras un post, añade su redirección 301 aquí (y en `astro.config.mjs`). Mejor no renombrar: ver el README.
- Si cambias el nombre de una carpeta de `public/` que tiene regla de caché, actualiza la regla.
