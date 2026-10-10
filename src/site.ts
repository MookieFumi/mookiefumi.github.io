// Configuración del sitio.
export const SITE = {
  url: 'https://mookiefumi.com',
  urlPretty: 'mookiefumi.com',
  title: '~/mookie',
  description: '.NET, IA y seguridad, explicados con laboratorios que puedes ejecutar',
  avatar: '/img/avatar-icon.jpg',
  author: {
    name: 'Miguel Angel Martin Hrdez',
    email: 'me@mookiefumi.com',
    github: 'MookieFumi',
    twitter: 'MookieFumi',
    linkedin: 'in/mookiefumi',
  },
  // Enlaces de la barra de navegación: texto y ruta (sin barra inicial).
  navbarLinks: [
    { label: 'posts', path: '' },
    { label: 'temas', path: 'temas' },
    { label: 'recursos', path: 'recursos' },
    { label: 'sobre-mí', path: 'aboutme' },
  ],
  // Cloudflare Web Analytics (sin cookies). Vacío para desactivarla.
  cloudflareAnalyticsToken: '8607a246a64647feb5441c86af7234bc',
  postsPerPage: 10,
};
