/* Service worker — Monitor Sísmico Panamá */
const VER = 'sismos-pa-v1';
const SHELL = ['./', 'index.html', 'manifest.json', 'favicon.ico', 'icons/icon-192.png', 'icons/icon-512.png', 'data/snapshot.json',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.heat/0.2.0/leaflet-heat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'];
const BOX = {la0: 5, la1: 11, lo0: -84.5, lo1: -76};
const FEED = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_hour.geojson';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VER).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER && k !== 'sismos-pa-state').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Datos USGS: siempre red, respaldo en caché
  if (u.hostname === 'earthquake.usgs.gov') {
    e.respondWith(fetch(e.request).then(r => { if (r.ok && u.pathname.includes('/query')) { const cp = r.clone(); caches.open(VER).then(c => c.put('usgs-last', cp)); } return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('usgs-last'))));
    return;
  }
  // Tiles OSM: red con caché oportunista
  if (u.hostname.endsWith('tile.openstreetmap.org')) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { const cp = r.clone(); caches.open(VER + '-tiles').then(c => c.put(e.request, cp)); return r; })));
    return;
  }
  // App: red primero (para recibir actualizaciones), caché si no hay conexión
  e.respondWith(fetch(e.request).then(r => { if (r.ok && (u.origin === location.origin || u.hostname === 'cdnjs.cloudflare.com')) { const cp = r.clone(); caches.open(VER).then(c => c.put(e.request, cp)); } return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});

/* Estado mínimo (umbral y eventos ya notificados) en Cache API */
async function getState() { try { const c = await caches.open('sismos-pa-state'); const r = await c.match('state'); return r ? await r.json() : {thr: 5, seen: []}; } catch (e) { return {thr: 5, seen: []}; } }
async function setState(s) { const c = await caches.open('sismos-pa-state'); await c.put('state', new Response(JSON.stringify(s), {headers: {'content-type': 'application/json'}})); }
self.addEventListener('message', e => { if (e.data && e.data.type === 'thr') getState().then(s => { s.thr = +e.data.thr; return setState(s); }); });

/* Revisión periódica en segundo plano (Chrome Android con la app instalada) */
async function checkFeed() {
  const s = await getState();
  const r = await fetch(FEED, {cache: 'no-store'}); if (!r.ok) return;
  const fc = await r.json();
  const evs = fc.features.filter(f => { const [lo, la] = f.geometry.coordinates; return la >= BOX.la0 && la <= BOX.la1 && lo >= BOX.lo0 && lo <= BOX.lo1 && f.properties.mag >= s.thr && !s.seen.includes(f.id); });
  for (const f of evs) {
    const p = f.properties; const t = new Date(p.time).toLocaleTimeString('es-PA', {timeZone: 'America/Panama', hour: '2-digit', minute: '2-digit', hour12: false});
    await self.registration.showNotification('Sismo M ' + (+p.mag).toFixed(1), {body: p.place + ' · ' + t + ' (Panamá)', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: f.id});
    s.seen.push(f.id);
  }
  s.seen = s.seen.slice(-300); await setState(s);
}
self.addEventListener('periodicsync', e => { if (e.tag === 'sismos') e.waitUntil(checkFeed().catch(() => null)); });
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type: 'window'}).then(cs => { for (const c of cs) if ('focus' in c) return c.focus(); return self.clients.openWindow('./'); }));
});
