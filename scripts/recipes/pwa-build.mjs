import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { load } from 'cheerio';

export const recipeRoute = '/post/15-minute-dump-and-go-instant-pot-recipes/';

// Each worker owns one complete built snapshot. Updates wait for recipe tabs to
// close so new HTML cannot mix with an older Svelte bundle during cooking.
export async function buildRecipePwa(directory) {
  const root = fileURLToPath(directory);
  const urls = new Set([recipeRoute, '/favicon.ico', '/data/recipe-library.json', '/data/recipe-library.md']);
  const add = (value, base = recipeRoute) => {
    const url = new URL(value, `https://recipe.invalid${base}`);
    if (url.origin === 'https://recipe.invalid' && !url.search) urls.add(url.pathname);
  };
  for (const page of [recipeRoute,...(await readdir(`${root}/recipes`)).filter(name=>!name.includes('.')).map(name=>`/recipes/${name}/`)]) {
  urls.add(page);
  // Parse noscript links too: those styles must work in the offline fallback.
  const $ = load(await readFile(`${root}${page}index.html`,'utf8'), { scriptingEnabled: false });
  const pageAdd=(value)=>add(value,page);
  $('[src], link[rel="stylesheet"], link[rel="modulepreload"], link[rel="manifest"], link[rel="apple-touch-icon"]').each((_, element) => {
    const value = $(element).attr('src') ?? $(element).attr('href');
    if (value) pageAdd(value);
  });
  $('[srcset]').each((_, element) => {
    for (const candidate of $(element).attr('srcset').split(',')) pageAdd(candidate.trim().split(/\s+/u)[0]);
  });
  $('astro-island').each((_, element) => {
    for (const attribute of ['component-url', 'renderer-url']) {
      const value = $(element).attr(attribute);
      if (value) pageAdd(value);
    }
  });
  }
  // Hydrated details choose image sizes absent from the server-rendered cards.
  for (const file of await readdir(`${root}/media/recipes`)) add(`/media/recipes/${file}`);
  for (const file of await readdir(`${root}/recipes-pwa`)) add(`/recipes-pwa/${file}`);
  const files = new Map();
  for (const url of urls) {
    const contents = await readFile(`${root}${url.endsWith('/') ? `${url}index.html` : url}`);
    files.set(url, contents);
    if (/\.(js|css)$/u.test(url)) {
      const source = contents.toString();
      for (const match of source.matchAll(/["']([^"'\s]+\.(?:js|css|woff2?))["']/gu)) add(match[1], url);
      for (const match of source.matchAll(/url\(["']?([^\s)"']+)["']?\)/gu)) add(match[1], url);
    }
  }
  const assets = [...urls].sort();
  const hash = createHash('sha256');
  for (const url of assets) hash.update(url).update(files.get(url));
  const cache = `recipe-pages-pwa-${hash.digest('hex').slice(0, 20)}`;
  const worker = `const CACHE = ${JSON.stringify(cache)};
const ROUTE = ${JSON.stringify(recipeRoute)};
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('recipe-pages-pwa-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const key = event.request.mode === 'navigate' && url.pathname === ROUTE ? ROUTE : url.pathname;
  if (!ASSETS.includes(key) || (event.request.mode === 'navigate' && !key.endsWith('/'))) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return (await cache.match(key)) || fetch(event.request);
  })());
});
`;
  await writeFile(`${root}/recipe-service-worker.js`, worker);
  // Keep installed apps on the legacy scope updateable without deleting the
  // caches used by active clients of the other registration.
  await writeFile(`${root}${recipeRoute}service-worker.js`, worker.replaceAll('recipe-pages-pwa-', 'recipe-pwa-'));
  return { cache, urls: assets };
}

export default function recipePwa() {
  return { name: 'recipe-pwa', hooks: { 'astro:build:done': async ({ dir }) => { await buildRecipePwa(dir); } } };
}
