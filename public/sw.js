/* Gestão de Rotinas Condominiais — service worker
   Objetivo: o app abrir e funcionar sem internet (subsolo, casa de máquinas).
   Os DADOS ficam no localStorage do aparelho; aqui cuidamos só de ter o
   aplicativo em si disponível offline. */
const VER   = 'grc-v7';
const SHELL = ['./', './index.html', './manifest.webmanifest',
  './icones/icone-192.png', './icones/icone-512.png',
  './icones/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VER)
      .then(c => c.addAll(SHELL).catch(() => c.add('./')))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Rede primeiro, mas sem deixar o usuário esperando: em 4 segundos sem
   resposta (wifi preso no subsolo, 3G fraco) servimos a cópia guardada. */
function redeComPrazo(req, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then(r => { clearTimeout(t); resolve(r); },
                    e => { clearTimeout(t); reject(e); });
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* A API nunca é guardada: dado velho de sincronização confunde o app.
     Offline, a própria tela trata a falha e mantém tudo salvo no aparelho. */
  if (url.pathname.startsWith('/api/')) return;

  const navegando = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  e.respondWith((async () => {
    const cache = await caches.open(VER);
    try {
      const r = await redeComPrazo(req, 4000);
      if (r && r.ok) cache.put(req, r.clone());
      return r;
    } catch (err) {
      const guardado = await cache.match(req) ||
                       (navegando ? await cache.match('./index.html') ||
                                    await cache.match('./') : null);
      if (guardado) return guardado;
      if (navegando) {
        return new Response(
          '<!doctype html><meta charset="utf-8">' +
          '<title>Sem conexão</title>' +
          '<body style="font-family:system-ui;padding:40px;color:#1a2230">' +
          '<h2>Sem conexão</h2><p>Abra o aplicativo uma vez com internet ' +
          'para que ele fique disponível offline.</p>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 });
      }
      throw err;
    }
  })());
});

/* A página avisa quando há uma versão nova para assumir na hora */
self.addEventListener('message', e => {
  if (e.data === 'atualizar') self.skipWaiting();
});
