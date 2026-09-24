/**
 * Plugin do Vite que gera o service worker (dist/sw.js) no build, com a lista de arquivos do jogo
 * para funcionar offline. Músicas (pesadas) não entram no pré-cache: são guardadas quando tocam.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const AUDIO = /\.(mp3|ogg|m4a|wav|flac|opus|webm|aac)$/i;

function listPublic(dir, base = '') {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? listPublic(path.join(dir, d.name), `${base}${d.name}/`) : [`${base}${d.name}`],
  );
}

export function pwaPlugin() {
  return {
    name: 'rnrr-pwa',
    apply: 'build',
    generateBundle(_options, bundle) {
      // áudio pequeno (efeitos, locutor) vai para o pré-cache; músicas grandes são guardadas quando tocam
      const small = (bytes) => bytes < 1_500_000;
      const built = Object.entries(bundle)
        .filter(([f, c]) => !f.endsWith('.map') && (!AUDIO.test(f) || small(c.type === 'asset' ? c.source.length : 0)))
        .map(([f]) => f);
      const pub = listPublic(path.resolve('public')).filter(
        // _headers é configuração do Cloudflare Pages, não é servido
        (f) => f !== 'sw.js' && f !== '_headers' && (!AUDIO.test(f) || small(fs.statSync(path.resolve('public', f)).size)),
      );
      const files = ['./', ...new Set([...built, ...pub].map((f) => `./${f}`))];
      const version = createHash('sha1').update(files.join('|')).digest('hex').slice(0, 10);
      const source = `// Gerado no build (scripts/pwa-plugin.mjs). Não editar.
const CACHE = 'rnrr3d-${version}';
const PRECACHE = ${JSON.stringify(files)};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('rnrr3d-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // /api/* (credenciais TURN do online) expira: nunca vem do cache
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // páginas: rede primeiro (pega atualizações), cache se offline
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return r; })
      .catch(() => caches.match(req).then((r) => r || caches.match('./'))));
    return;
  }
  // arquivos do jogo e músicas: cache primeiro, guarda o que baixar
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok && r.status === 200) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return r;
  })));
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
