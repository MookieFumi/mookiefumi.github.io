import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

// Imagen para compartir un post (1200x630): título y tema sobre la marca del blog.
// Satori solo entiende ttf, otf y woff, así que se usan los ficheros .woff de @fontsource.
// El build se ejecuta desde la raíz del repo; `import.meta.url` apunta al bundle, no al fuente.
const font = (weight: 400 | 700) =>
  readFileSync(join(process.cwd(), 'node_modules/@fontsource/geist/files', `geist-latin-${weight}-normal.woff`));
const fonts = [
  { name: 'Geist', data: font(400), weight: 400 as const, style: 'normal' as const },
  { name: 'Geist', data: font(700), weight: 700 as const, style: 'normal' as const },
];

// Colores de public/css de la marca (tokens.css) y de cada tema.
const TOPIC_COLORS: Record<string, string> = {
  maui: '#FF8FD1',
  xamarin: '#5C8DFF',
  testing: '#4ADE80',
  aspnet: '#FFB547',
  desarrollo: '#B8F25B',
  ia: '#B39CFF',
  k8s: '#5CC8FF',
  dotnet: '#FF6B7A',
};

type Node = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, children?: unknown): Node => ({
  type,
  props: { style: { display: 'flex', ...style }, children },
});

// La fuente solo tiene el subconjunto latino: las flechas dobles se pasan a «/» y
// cualquier otro símbolo fuera de él se descarta para que no salga un cuadrado.
const printable = (text: string) =>
  text
    .replace(/[↔⇄⇔]/g, '/')
    .replace(/[^\u0020-\u024F\u2010-\u2027\u20AC]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export async function postOgImage(rawTitle: string, topicId: string, topicName: string): Promise<Uint8Array> {
  const title = printable(rawTitle);
  const accent = TOPIC_COLORS[topicId] ?? '#B8F25B';
  const size = title.length <= 48 ? 76 : title.length <= 80 ? 62 : 52;
  const tree = h('div', {
    width: 1200,
    height: 630,
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: 72,
    background: '#05070A',
    color: '#E6EDF3',
    fontFamily: 'Geist',
    borderTop: `10px solid ${accent}`,
    boxSizing: 'border-box',
  }, [
    h('div', { fontSize: 38, fontWeight: 700, color: '#B8F25B' }, '~/mookie'),
    h('div', { fontSize: size, fontWeight: 700, lineHeight: 1.12, letterSpacing: -2 }, title),
    h('div', { justifyContent: 'space-between', alignItems: 'center', fontSize: 30 }, [
      h('div', { color: accent, border: `2px solid ${accent}`, borderRadius: 999, padding: '8px 24px', fontWeight: 700 }, topicName),
      h('div', { color: '#8B96A5' }, 'mookiefumi.com'),
    ]),
  ]);
  const svg = await satori(tree as never, { width: 1200, height: 630, fonts });
  return new Resvg(svg).render().asPng();
}
