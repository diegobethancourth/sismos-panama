/* Service worker — Sismos Panamá v1.2.0 */
const VER = 'sismos-pa-v10';
const SHELL = ['./', 'index.html', 'manifest.json', 'favicon.ico', 'icons/icon-192.png', 'icons/icon-512.png', 'data/snapshot.json',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.heat/0.2.0/leaflet-heat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'];
const BOX = {la0: 5, la1: 11, lo0: -84.5, lo1: -76};
const STATE = 'sismos-pa-state';

self.addEventListener('install', e => { e.waitUntil(caches.open(VER).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER && k !== STATE && k !== VER + '-tiles').map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.hostname === 'earthquake.usgs.gov' || u.hostname.endsWith('seismicportal.eu') || u.hostname.endsWith('workers.dev')) return;   // datos siempre de la red
  if (u.hostname.endsWith('tile.openstreetmap.org')) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { const cp = r.clone(); caches.open(VER + '-tiles').then(c => c.put(e.request, cp)); return r; })));
    return;
  }
  e.respondWith(fetch(e.request).then(r => { if (r.ok && (u.origin === location.origin || u.hostname === 'cdnjs.cloudflare.com')) { const cp = r.clone(); caches.open(VER).then(c => c.put(e.request, cp)); } return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});

/* estado mínimo: umbral, URL del servidor de alertas y sismos ya notificados */
async function getState() { try { const r = await (await caches.open(STATE)).match('state'); const s = r ? await r.json() : {}; s.seen = (s.seen || []).filter(x => typeof x === 'object'); if (s.thr == null) s.thr = 5; return s; } catch (e) { return {thr: 5, seen: []}; } }
async function setState(s) { await (await caches.open(STATE)).put('state', new Response(JSON.stringify(s), {headers: {'content-type': 'application/json'}})); }
self.addEventListener('message', e => { const d = e.data || {}; if (d.type === 'cfg') e.waitUntil(getState().then(s => { s.thr = +d.thr; s.api = d.api || ''; return setState(s); })); });

const hora = t => new Date(t).toLocaleTimeString('es-PA', {timeZone: 'America/Panama', hour: '2-digit', minute: '2-digit', hour12: false});
const lugar = s => String(s || '').replace(/(\d+) km (\w+) of /, (m, k, d) => k + ' km al ' + d.replace(/W/g, 'O') + ' de ').replace(/, Panama$/, '').replace(/\bPanama\b/g, 'Panamá');
function near(a, b) { const r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r; const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2; return Math.abs(a.t - b.t) <= 20000 && 12742 * Math.asin(Math.sqrt(x)) <= 60; }
async function show(e, s) {
  if (s.seen.some(x => x.id === e.id || near(x, e))) return false;
  await self.registration.showNotification('Sismo M ' + (+e.mag).toFixed(1), {body: lugar(e.place) + ' · ' + hora(e.t) + ' (Panamá) · Prof. ' + Math.round(e.depth || 10) + ' km', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: String(e.id), renotify: true, vibrate: e.mag >= 6 ? [400, 150, 400, 150, 400] : [200, 100, 200], data: {url: './'}});
  s.seen.push({id: e.id, t: e.t, lat: e.lat, lon: e.lon}); s.seen = s.seen.slice(-300); return true;
}

/* Web Push del servidor (sin contenido): se pide el último sismo y se muestra */
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    const s = await getState();
    let ev = null;
    try { if (e.data) ev = e.data.json().event; } catch (err) {}
    if (!ev && s.api) { try { ev = (await (await fetch(s.api + '/latest?thr=' + (s.thr || 5), {cache: 'no-store'})).json()).event; } catch (err) {} }
    if (ev && await show(ev, s)) { await setState(s); return; }
    // ya avisado (llegó por otra vía): se reemplaza la misma notificación sin volver a sonar, para cumplir con el navegador
    if (ev) { await self.registration.showNotification('Sismo M ' + (+ev.mag).toFixed(1), {body: lugar(ev.place) + ' · ' + hora(ev.t) + ' (Panamá)', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: String(ev.id), renotify: false, silent: true}); return; }
    // al recibir un push siempre hay que mostrar algo (exigencia de los navegadores)
    if (!ev) await self.registration.showNotification('Nuevo sismo en Panamá', {body: 'Abre la app para ver los detalles.', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'sismo'});
  })());
});

/* revisión periódica en segundo plano (Chrome Android con la app instalada), respaldo del push */
async function checkFeed() {
  const s = await getState(); if (!s.thr || s.thr > 9) return;
  const evs = [];
  try { const r = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_hour.geojson', {cache: 'no-store'}); if (r.ok) (await r.json()).features.forEach(f => evs.push({id: f.id, t: f.properties.time, mag: +f.properties.mag, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], depth: f.geometry.coordinates[2], place: f.properties.place})); } catch (e) {}
  const hits = evs.filter(e => e.lat >= BOX.la0 && e.lat <= BOX.la1 && e.lon >= BOX.lo0 && e.lon <= BOX.lo1 && e.mag >= s.thr).sort((a, b) => a.t - b.t);
  let changed = false; for (const e of hits) changed = (await show(e, s)) || changed;
  if (changed) await setState(s);
}
self.addEventListener('periodicsync', e => { if (e.tag === 'sismos') e.waitUntil(checkFeed().catch(() => null)); });
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(cs => { for (const c of cs) if ('focus' in c) return c.focus(); return self.clients.openWindow('./'); }));
});
