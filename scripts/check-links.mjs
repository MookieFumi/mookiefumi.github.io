// Checks that the internal links (href and src) in `dist/` point to files that exist.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';

const dist = resolve(process.argv[2] ?? 'dist');
const siteOrigin = 'https://mookiefumi.com';

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

function exists(path) {
  if (existsSync(path) && statSync(path).isFile()) return true;
  return [`${path}.html`, join(path, 'index.html')].some((p) => existsSync(p));
}

const broken = [];
for (const file of walk(dist)) {
  if (extname(file) !== '.html') continue;
  const html = readFileSync(file, 'utf8');
  for (const [, , raw] of html.matchAll(/\s(href|src)=["']([^"']+)["']/g)) {
    let url = raw.trim();
    if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url)) {
      // Absolute links to this site count as internal; any other host, mailto:, data: or anchor is skipped.
      let parsed;
      try {
        parsed = new URL(url, siteOrigin);
      } catch {
        continue;
      }
      if (parsed.origin !== siteOrigin || url.startsWith('#')) continue;
      url = parsed.pathname + parsed.search;
    }
    const path = decodeURIComponent(url.split(/[?#]/)[0]);
    if (!path) continue;
    const target = path.startsWith('/') ? join(dist, path) : resolve(dirname(file), path);
    if (!exists(target)) broken.push(`${file.slice(dist.length)}  ->  ${raw}`);
  }
}

if (broken.length) {
  console.error(`Broken internal links (${broken.length}):`);
  for (const line of [...new Set(broken)]) console.error(`  ${line}`);
  process.exit(1);
}
console.log('No broken internal links.');
