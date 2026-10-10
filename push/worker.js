/**
 * SISMOS PANAMÁ — servicio de notificaciones push (Cloudflare Worker, un solo archivo)
 * -------------------------------------------------------------------------------
 * - Cada minuto (Cron Trigger) consulta USGS, EMSC y el Instituto de Geociencias (IGC-UP, la red nacional; el más rápido para Panamá).
 * - Si hay un sismo nuevo, envía Web Push a cada teléfono suscrito cuyo umbral se alcance.
 * - Los teléfonos se suscriben desde la app (botón "Activar alertas").
 *
 * El push se envía SIN contenido cifrado ("tickle"): el teléfono despierta, el service
 * worker de la app pide /latest y muestra la notificación. Así no hace falta cifrar cada
 * mensaje y el Worker cabe en el plan gratuito (10 ms de CPU por ejecución).
 *
 * Requisitos en Cloudflare (ver push/LEEME.md):
 *   - Namespace KV enlazado con el nombre  SISMOS
 *   - Cron Trigger:  * * * * *
 *   - Variable opcional PUSH_BUDGET (envíos por minuto; 45 en plan gratuito, 5000 en plan de pago)
 *
 * Rutas:  GET /vapid   GET /latest?thr=5   GET /igc   GET /status   POST /subscribe   POST /unsubscribe
 */

const APP_URL = 'https://diegobethancourth.github.io/sismos-panama/';
const ORIGINS = ['https://diegobethancourth.github.io', 'http://localhost:8765', 'http://localhost:8766'];
const BOX = {la0: 5, la1: 11, lo0: -84.5, lo1: -76};
const MIN_MAG = 4.5;              // por debajo de esto no se avisa a nadie
const IGC_URL = 'https://sismosgeociencias.up.ac.pa/';   // listado público del IGC (últimos 7 días)
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.api\.chromium\.org)$/;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(req);
    if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
    try {
      if (url.pathname === '/vapid') return json({key: (await vapidKeys(env)).pub}, cors);
      if (url.pathname === '/latest') {
        const thr = +url.searchParams.get('thr') || MIN_MAG;
        const st = await state(env);
        const ev = (st.alerts || []).filter(a => a.mag >= thr && Date.now() - a.sentAt < 3 * 3600e3).sort((a, b) => b.sentAt - a.sentAt || b.mag - a.mag)[0] || null;
        return json({event: ev}, cors);
      }
      if (url.pathname === '/igc') {
        // la app lee aquí el listado del IGC (su página no permite lectura directa desde otro sitio); se refresca cada minuto con el cron
        const st = await state(env);
        return json({at: st.igcAt || null, events: st.igc || []}, Object.assign({'cache-control': 'public, max-age=30'}, cors));
      }
      if (url.pathname === '/status') {
        const st = await state(env);
        return json({lastRun: st.lastRun || null, lastOk: st.lastOk || null, sources: st.sources || '', lastAlert: (st.alerts || [])[0] || null, pending: !!st.pending}, cors);
      }
      if (url.pathname === '/subscribe' && req.method === 'POST') {
        const b = await req.json();
        const sub = b.sub || {}; const thr = [4.5, 5, 6].includes(+b.thr) ? +b.thr : 5;
        if (!sub.endpoint || !PUSH_HOSTS.test(new URL(sub.endpoint).hostname)) return json({error: 'endpoint no válido'}, cors, 400);
        await env.SISMOS.put('s:' + await hashId(sub.endpoint), '1', {metadata: {e: sub.endpoint, t: thr}});
        return json({ok: true, thr}, cors);
      }
      if (url.pathname === '/unsubscribe' && req.method === 'POST') {
        const b = await req.json();
        if (b.endpoint) await env.SISMOS.delete('s:' + await hashId(b.endpoint));
        return json({ok: true}, cors);
      }
      return json({service: 'sismos-panama-push', ok: true}, cors);
    } catch (err) {
      return json({error: String(err)}, cors, 500);
    }
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(run(env)); }
};

/* ================= ciclo de cada minuto ================= */
async function run(env) {
  const st = await state(env);
  let dirty = false;
  const budget = +(env.PUSH_BUDGET || 45);

  // 1) si quedó un envío a medias (más suscriptores que el presupuesto del minuto), se continúa
  if (st.pending) { await sendBatch(env, st, budget); await save(env, st); return; }

  // 2) consulta fuentes
  const evs = await fetchEvents(st);
  st.lastRun = Date.now();
  if (!evs) { /* no se escribe cada minuto para respetar el límite de escrituras de KV */ return; }
  st.lastOk = Date.now();

  st.seen = (st.seen || []).filter(x => Date.now() - x.t < 2 * 864e5);
  const fresh = [];
  for (const e of evs) {
    const v = st.seen.find(x => x.id === e.id || same(x, e));
    if (!v) { st.seen.push(slim(e)); fresh.push(e); dirty = true; }
    else if (e.mag - v.mag >= 0.5) { v.mag = e.mag; e.revised = true; fresh.push(e); dirty = true; }
  }
  st.seen = st.seen.slice(-300);
  const alert = fresh.filter(e => e.mag >= MIN_MAG).sort((a, b) => b.mag - a.mag)[0];
  if (alert) {
    alert.sentAt = Date.now();
    st.alerts = [alert].concat(st.alerts || []).slice(0, 15);
    st.pending = {mag: alert.mag, urgent: alert.mag >= 6, cursor: null};
    await sendBatch(env, st, budget);
    dirty = true;
  }
  // estado: se guarda solo si cambió algo, o como latido cada ~30 min
  if (dirty || st.igcChanged || !st.beat || Date.now() - st.beat > 30 * 60e3) { delete st.igcChanged; st.beat = Date.now(); await save(env, st); }
}

async function fetchEvents(st) {
  const since = new Date(Date.now() - 30 * 60e3).toISOString().slice(0, 19);
  const q = `starttime=${since}&minlatitude=${BOX.la0}&maxlatitude=${BOX.la1}&minlongitude=${BOX.lo0}&maxlongitude=${BOX.lo1}&minmagnitude=2.5`;
  const [ru, re, ri] = await Promise.allSettled([
    fetch('https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&' + q, {cf: {cacheTtl: 0}}),
    fetch('https://www.seismicportal.eu/fdsnws/event/1/query?format=json&' + q, {cf: {cacheTtl: 0}}),
    fetch(IGC_URL, {cf: {cacheTtl: 0}, headers: {'User-Agent': 'sismos-panama (monitor ciudadano)'}})]);
  const usgs = [], emsc = [], src = [];
  if (ru.status === 'fulfilled' && ru.value.ok) {
    src.push('USGS ok');
    (await ru.value.json()).features.forEach(f => { const p = f.properties, g = f.geometry.coordinates;
      usgs.push({id: f.id, src: 'USGS', t: p.time, mag: +p.mag, lat: g[1], lon: g[0], depth: Math.max(0, +g[2] || 10), place: p.place || ''}); });
  } else src.push('USGS error');
  const codeE = re.status === 'fulfilled' ? re.value.status : 0;
  if (codeE === 200) {
    src.push('EMSC ok');
    (await re.value.json()).features.forEach(f => { const p = f.properties;
      emsc.push({id: p.unid, src: 'EMSC', t: Date.parse(p.time), mag: +p.mag, lat: +p.lat, lon: +p.lon, depth: Math.abs(+p.depth) || 10, place: titleCase(p.flynn_region || '')}); });
  } else src.push(codeE === 204 ? 'EMSC sin eventos' : 'EMSC error');
  let igc = [];
  if (ri.status === 'fulfilled' && ri.value.ok) {
    try {
      igc = parseIGC(await ri.value.text()); src.push('IGC ok');
      // el listado completo (7 días) se guarda solo si cambió, para respetar el límite de escrituras de KV
      const sig = igc.slice(0, 40).map(e => e.id + e.mag + e.status).join('|');
      if (sig !== st.igcSig) { st.igc = igc; st.igcSig = sig; st.igcAt = Date.now(); st.igcChanged = true; }
    } catch (e) { src.push('IGC sin formato'); }
  } else src.push('IGC error');
  st.sources = src.join(' · ');
  if (!usgs.length && !igc.length && src[0] !== 'USGS ok' && codeE !== 200 && codeE !== 204) return null;
  const out = usgs.slice();
  for (const x of emsc) { const hit = out.find(e => same(e, x)); if (hit) { if (hit.src === 'USGS') hit.src = 'USGS+EMSC'; } else out.push(x); }
  const since30 = Date.now() - 30 * 60e3;
  for (const x of igc.filter(e => e.t >= since30)) { const hit = out.find(e => same(e, x)); if (hit) { hit.src += '+IGC'; hit.place = x.place; } else out.push(x); }
  return out.filter(e => isFinite(e.mag) && isFinite(e.t)).sort((a, b) => a.t - b.t);
}

/* ================= envío de Web Push ================= */
async function sendBatch(env, st, budget) {
  const P = st.pending; let sent = 0; const jwts = {};
  const keys = await vapidKeys(env);
  let cursor = P.cursor || undefined;
  do {
    const page = await env.SISMOS.list({prefix: 's:', cursor, limit: 1000});
    const subs = page.keys.filter(k => k.metadata && k.metadata.t <= P.mag);
    // si el presupuesto no alcanza para esta página, se procesa parcial y se guarda el punto exacto
    for (let i = 0; i < subs.length; i++) {
      if (sent >= budget) { P.cursor = cursor; P.skip = i; return; }
      if (P.skip && i < P.skip) continue;
      const k = subs[i]; const ep = k.metadata.e; const aud = new URL(ep).origin;
      if (!jwts[aud]) jwts[aud] = await vapidJWT(keys, aud);
      try {
        const r = await fetch(ep, {method: 'POST', headers: {TTL: '3600', Urgency: P.urgent ? 'high' : 'normal', Authorization: `vapid t=${jwts[aud]}, k=${keys.pub}`, 'Content-Length': '0'}});
        if (r.status === 404 || r.status === 410) await env.SISMOS.delete(k.name);   // suscripción vencida
      } catch (e) { /* se reintenta en el próximo sismo */ }
      sent++;
    }
    P.skip = 0;
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  st.pending = null;
}

/* ================= VAPID (ES256) ================= */
async function vapidKeys(env) {
  const saved = await env.SISMOS.get('vapid', 'json');
  if (saved) return saved;
  // se generan una sola vez y quedan guardadas en tu KV; la clave privada nunca sale de tu cuenta
  const kp = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const keys = {jwk, pub: b64u(raw)};
  await env.SISMOS.put('vapid', JSON.stringify(keys));
  return keys;
}
async function vapidJWT(keys, aud) {
  const enc = s => b64u(new TextEncoder().encode(JSON.stringify(s)));
  const head = enc({typ: 'JWT', alg: 'ES256'});
  const body = enc({aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: APP_URL});
  const key = await crypto.subtle.importKey('jwk', keys.jwk, {name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, key, new TextEncoder().encode(head + '.' + body)));
  return head + '.' + body + '.' + b64u(sig);
}

/* ================= utilidades ================= */
async function state(env) { return (await env.SISMOS.get('state', 'json')) || {}; }
async function save(env, st) { await env.SISMOS.put('state', JSON.stringify(st)); }
function slim(e) { return {id: e.id, src: e.src, status: e.status, t: e.t, lat: Math.round(e.lat * 1000) / 1000, lon: Math.round(e.lon * 1000) / 1000, mag: e.mag}; }
// mismo sismo en dos reportes: ≤20 s (≤30 s si uno es del IGC), ≤60 km y ≤1 de magnitud.
// El IGC publica primero una versión PRELIMINAR y luego la REVISADA, que puede mover la hora 1–2 min: se aceptan ≤180 s y ≤0.5 de magnitud.
function same(a, b) {
  const d = dist(a.lat, a.lon, b.lat, b.lon), dt = Math.abs(a.t - b.t), dm = Math.abs(a.mag - b.mag);
  const igcA = String(a.src || '').includes('IGC'), igcB = String(b.src || '').includes('IGC');
  if (igcA && igcB && a.status !== b.status) return dt <= 180000 && dm <= 0.5 && d <= 60;
  return dt <= (igcA || igcB ? 30000 : 20000) && dm <= 1 && d <= 60;
}
/* listado del IGC: cada fila trae un enlace "Ver" con todos los datos en la URL (ultimosismo.html?lt=..&ln=..&p=..&e=..&h=..&f=..&m=..&r=..) */
function parseIGC(html) {
  const out = [], seenQ = new Set(), re = /ultimosismo\.html\?([^"'<>\s]+)/g; let m;
  while ((m = re.exec(html))) {
    const qs = m[1].replace(/&amp;/g, '&'); if (seenQ.has(qs)) continue; seenQ.add(qs);
    const q = new URLSearchParams(qs), lat = +q.get('lt'), lon = +q.get('ln'), mag = +q.get('m'), t = igcTime(q.get('f'), q.get('h'));
    if (!isFinite(lat) || !isFinite(lon) || !isFinite(mag) || !isFinite(t)) continue;
    const status = /REVISADO/i.test(q.get('e') || '') ? 'reviewed' : 'automatic';
    out.push({id: 'IGC-' + q.get('f') + 'T' + q.get('h') + '-' + lat.toFixed(3), src: 'IGC', status, t, mag, lat, lon, depth: parseFloat(q.get('p')) || 10, place: igcPlace(q.get('r'))});
  }
  // si aparecen la versión preliminar y la revisada del mismo sismo, queda la revisada
  const keep = out.filter(e => !(e.status === 'automatic' && out.some(x => x !== e && x.status === 'reviewed' && same(x, e))));
  return keep.sort((a, b) => b.t - a.t);
}
function igcTime(f, h) {   // fecha y hora local de Panamá (UTC−5) con AM/PM
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f || ''), c = /^(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)$/i.exec((h || '').trim()); if (!d || !c) return NaN;
  let H = +c[1] % 12; if (/PM/i.test(c[4])) H += 12;
  return Date.UTC(+d[1], +d[2] - 1, +d[3], H + 5, +c[2], +c[3]);
}
function igcPlace(r) { return String(r || '').trim().replace(/^Localizado en\s+/i, '').replace(/^Panamá a\s+/i, '').replace(/(\d+)\s*km/i, '$1 km'); }
function dist(a, b, c, d) { const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); }
function titleCase(s) { return s.toLowerCase().replace(/(^|[\s,-])([a-z])/g, (m, a, b) => a + b.toUpperCase()); }
function b64u(u8) { let s = ''; for (const c of u8) s += String.fromCharCode(c); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function hashId(s) { const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))); return b64u(h).slice(0, 22); }
function corsHeaders(req) {
  const o = req.headers.get('Origin') || '';
  return {'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0], 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'content-type', Vary: 'Origin'};
}
function json(obj, headers, status) { return new Response(JSON.stringify(obj), {status: status || 200, headers: Object.assign({'content-type': 'application/json', 'cache-control': 'no-store'}, headers)}); }
