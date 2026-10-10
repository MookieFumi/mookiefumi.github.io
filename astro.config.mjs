// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import { mookieTheme, codeBlockWrapper } from './src/lib/shiki.mjs';

export default defineConfig({
  site: 'https://mookiefumi.com',
  integrations: [react(), mdx()],
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
    // El slug de este post tenía mayúsculas; ahora todos van en minúsculas.
    '/2019-10-20-unit-testing-tools-using-your-MacOS-terminal':
      '/2019-10-20-unit-testing-tools-using-your-macos-terminal',
  },
});
