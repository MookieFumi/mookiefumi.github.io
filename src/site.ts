// Configuración del sitio.
export const SITE = {
  url: 'https://mookiefumi.com',
  urlPretty: 'mookiefumi.com',
  title: '~/mookie',
  description: 'Arquitectura .NET y equipos que escalan: calidad, CI/CD e IA',
  avatar: '/img/avatar-icon.jpg',
  author: {
    name: 'Miguel A. Martín Hrdez',
    email: 'me@mookiefumi.com',
    github: 'MookieFumi',
    twitter: 'MookieFumi',
    linkedin: 'in/mookiefumi',
  },
  // Enlaces de la barra de navegación: texto y ruta (sin barra inicial).
  navbarLinks: [
    { label: 'posts', path: '' },
    { label: 'temas', path: 'topics/' },
    { label: 'series', path: 'series/' },
    { label: 'recursos', path: 'resources' },
    { label: 'sobre-mí', path: 'aboutme' },
  ],
  postsPerPage: 10,
};
