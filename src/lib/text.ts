// Tiempo de lectura y extractos a partir del HTML ya renderizado de un post.

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'");
}

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

// 200 palabras por minuto, redondeando hacia arriba y como mínimo 1.
export function readingTime(html: string): string {
  const minutes = Math.max(1, Math.ceil(words(stripHtml(html)).length / 200));
  return `${minutes} min`;
}

function truncateWords(text: string, count: number): string {
  const list = words(text);
  return list.length > count ? `${list.slice(0, count).join(' ')}...` : list.join(' ');
}

// Usa el subtítulo si existe; si no, el texto de los primeros párrafos (sin
// títulos, listas ni código) para no repetir el título del post.
export function excerpt(html: string, subtitle: string | undefined, count: number): string {
  if (subtitle) return subtitle;
  const paragraphs = html.split('<p>').slice(1, 5).map((chunk) => chunk.split('</p>')[0]);
  return truncateWords(stripHtml(paragraphs.join(' ')).replace(/\n/g, ''), count);
}

// Las primeras palabras de todo el texto de un post (para el RSS).
export function summary(html: string, count: number): string {
  return truncateWords(stripHtml(html), count);
}
