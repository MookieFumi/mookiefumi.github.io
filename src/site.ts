// Configuración del sitio.
export const SITE = {
  url: 'https://mookiefumi.com',
  urlPretty: 'mookiefumi.com',
  title: '~/mookie',
  description: '.NET, IA y calidad de software, explicados con laboratorios que puedes ejecutar',
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
    { label: 'temas', path: 'topics' },
    { label: 'recursos', path: 'resources' },
    { label: 'sobre-mí', path: 'aboutme' },
  ],
  postsPerPage: 10,
};
