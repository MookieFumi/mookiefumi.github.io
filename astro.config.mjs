// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://mookiefumi.com',
  // Genera `slug.html` en lugar de `slug/index.html` para conservar las URLs
  // de Jekyll (`/AAAA-MM-DD-slug`, sin barra final).
  build: {
    format: 'file',
  },
  redirects: {
    // El slug de este post tenía mayúsculas; ahora todos van en minúsculas.
    '/2019-10-20-unit-testing-tools-using-your-MacOS-terminal':
      '/2019-10-20-unit-testing-tools-using-your-macos-terminal',
  },
});
