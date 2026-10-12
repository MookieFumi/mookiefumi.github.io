// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import { readdirSync, readFileSync } from 'node:fs';
import { mookieTheme, codeBlockWrapper } from './src/lib/shiki.mjs';

// Datos de cada post para el sitemap, leídos del front matter: `lastmod` (`updated` o, si
// falta, `date`) y si el post es `noindex` (no entra en el sitemap).
const postsDir = new URL('./src/content/posts/', import.meta.url);
const posts = new Map(
  readdirSync(postsDir)
    .filter((file) => /\.mdx?$/.test(file))
    .map((file) => {
      const front = readFileSync(new URL(file, postsDir), 'utf8').split('---')[1] ?? '';
      const date = front.match(/^updated:\s*(\S+)/m)?.[1] ?? front.match(/^date:\s*(\S+)/m)?.[1];
      return [file.replace(/\.mdx?$/, ''), { date, noindex: /^noindex:\s*true/m.test(front) }];
    }),
);
/** @param {string} page */
const postOf = (page) => posts.get(new URL(page).pathname.slice(1));

export default defineConfig({
  site: 'https://mookiefumi.com',
  integrations: [react(), mdx(), sitemap({
      filter: (page) =>
        !page.endsWith('/404') &&
        !page.endsWith('/404.html') &&
        // La paginación no entra en el sitemap: el valor está en los posts.
        !/\/page\d+\/?$/.test(page) &&
        !postOf(page)?.noindex,
      // Las listas (`/series/`, `/topics/`) se sirven con barra final, igual que su canonical.
      serialize: (item) => {
        const date = postOf(item.url)?.date;
        return {
          ...item,
          url: item.url.replace(/\/(series|topics)$/, '/$1/'),
          lastmod: date ? new Date(date).toISOString() : undefined,
        };
      },
    })],
  // Genera los ficheros tal como están en `src/pages`: `slug.html` para los
  // posts (`/AAAA-MM-DD-slug`, sin barra final) y
  // `page2/index.html` para la paginación (`/page2/`).
  build: {
    format: 'preserve',
  },
  // Conserva un espacio entre elementos en línea.
  compressHTML: true,
  markdown: {
    shikiConfig: {
      theme: mookieTheme,
      transformers: [codeBlockWrapper()],
    },
  },
  redirects: {
    // Las páginas de temas y recursos pasaron a URLs en inglés.
    '/temas': '/topics/',
    '/recursos': '/resources',
    // El slug de este post tenía mayúsculas; ahora todos van en minúsculas.
    '/2019-10-20-unit-testing-tools-using-your-MacOS-terminal':
      '/2019-10-20-unit-testing-tools-using-your-macos-terminal',
  },
});
