/* Service worker — Monitor Sísmico Panamá */
const VER = 'sismos-pa-v2';
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
function near(a, b) { const r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r; const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2; return Math.abs(a.t - b.t) <= 60000 && 12742 * Math.asin(Math.sqrt(x)) <= 100; }
async function checkFeed() {
  const s = await getState(); s.seen = (s.seen || []).filter(x => typeof x === 'object');
  const evs = [];
  try { const r = await fetch(FEED, {cache: 'no-store'}); if (r.ok) (await r.json()).features.forEach(f => evs.push({src: 'USGS', id: f.id, t: f.properties.time, mag: +f.properties.mag, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], place: f.properties.place})); } catch (e) {}
  try {
    const st = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 19);
    const r = await fetch('https://www.seismicportal.eu/fdsnws/event/1/query?format=json&minmagnitude=2.5&starttime=' + st + '&minlatitude=' + BOX.la0 + '&maxlatitude=' + BOX.la1 + '&minlongitude=' + BOX.lo0 + '&maxlongitude=' + BOX.lo1, {cache: 'no-store'});
    if (r.ok) (await r.json()).features.forEach(f => { const p = f.properties; evs.push({src: 'EMSC', id: p.unid, t: Date.parse(p.time), mag: +p.mag, lat: +p.lat, lon: +p.lon, place: p.flynn_region}); });
  } catch (e) {}
  const hits = evs.filter(e => e.lat >= BOX.la0 && e.lat <= BOX.la1 && e.lon >= BOX.lo0 && e.lon <= BOX.lo1 && e.mag >= s.thr).sort((a, b) => a.t - b.t);
  for (const e of hits) {
    if (s.seen.some(x => x.id === e.id || near(x, e))) continue;
    const t = new Date(e.t).toLocaleTimeString('es-PA', {timeZone: 'America/Panama', hour: '2-digit', minute: '2-digit', hour12: false});
    await self.registration.showNotification('Sismo M ' + e.mag.toFixed(1), {body: e.place + ' · ' + t + ' (Panamá) · ' + e.src, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: e.id});
    s.seen.push({id: e.id, t: e.t, lat: e.lat, lon: e.lon});
  }
  s.seen = s.seen.slice(-300); await setState(s);
}
self.addEventListener('periodicsync', e => { if (e.tag === 'sismos') e.waitUntil(checkFeed().catch(() => null)); });
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type: 'window'}).then(cs => { for (const c of cs) if ('focus' in c) return c.focus(); return self.clients.openWindow('./'); }));
});
