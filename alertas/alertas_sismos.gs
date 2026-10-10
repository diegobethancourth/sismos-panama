/**
 * ALERTAS SÍSMICAS PANAMÁ — notificación push (ntfy), sin correo
 * ------------------------------------------------------------------
 * Revisa USGS y EMSC cada minuto. Si hay un sismo nuevo en la región de Panamá
 * sobre el umbral, envía una notificación push al teléfono vía ntfy
 * (app gratuita Android/iOS). No usa Gmail: no consume cuota de correo.
 *
 * Proyecto independiente: créalo en la cuenta personal (no en los proyectos CSS),
 * así no comparte triggers ni cuotas con el ecosistema DINALOG.
 *
 * Instalación: ver alertas/LEEME.md. Funciones públicas para ejecutar a mano:
 *   instalar()        crea el trigger de 1 minuto y envía una prueba
 *   probarAlerta()    envía una notificación de prueba
 *   estado()          muestra en el registro la última corrida y lo enviado
 *   desinstalar()     elimina el trigger
 */

var CFG_SISMOS = {
  PUSH_MIN_MAG: 4.5,                           // notificar desde esta magnitud
  URGENTE_MIN_MAG: 6.0,                        // desde aquí prioridad máxima (suena aunque el teléfono esté en silencio, si lo permites en ntfy)
  NTFY_SERVER: 'https://ntfy.sh',
  BOX: {la0: 5, la1: 11, lo0: -84.5, lo1: -76},
  APP_URL: 'https://diegobethancourth.github.io/sismos-panama/',
  VENTANA_MIN: 30                              // minutos hacia atrás que se consultan en cada corrida
};

/* ============ funciones públicas ============ */

function instalar() {
  desinstalar();
  ScriptApp.newTrigger('revisarSismos').timeBased().everyMinutes(1).create();
  var topic = topicNtfy();
  // marca como vistos los sismos actuales para no recibir una avalancha al instalar
  var evs = obtenerEventos();
  guardarVistos(evs.map(function (e) { return resumen(e); }));
  probarAlerta();
  Logger.log('Trigger instalado (cada 1 min). Tema ntfy: ' + topic + '\nSuscríbete en la app ntfy a ese tema, o abre ' + CFG_SISMOS.NTFY_SERVER + '/' + topic);
}

function desinstalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'revisarSismos') ScriptApp.deleteTrigger(t);
  });
}

function probarAlerta() {
  var e = {src: 'PRUEBA', id: 'prueba-' + Date.now(), t: Date.now(), mag: 5.5, magType: 'mb', lat: 7.59, lon: -80.77, depth: 10,
           place: 'Prueba del sistema de alertas (no es un sismo real)', url: CFG_SISMOS.APP_URL};
  enviarPush([e], true);
  Logger.log('Prueba enviada al tema ntfy ' + topicNtfy());
}

function estado() {
  var p = PropertiesService.getScriptProperties();
  Logger.log('Última corrida: ' + p.getProperty('SP_LAST_RUN') + '\nÚltima consulta OK: ' + p.getProperty('SP_LAST_OK') +
    '\nFuentes: ' + p.getProperty('SP_LAST_SRC') + '\nÚltimo envío: ' + p.getProperty('SP_LAST_SENT') +
    '\nTema ntfy: ' + topicNtfy() + '\nTriggers: ' + ScriptApp.getProjectTriggers().length);
}

/* ============ corrida del trigger ============ */

function revisarSismos() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty('SP_LAST_RUN', ahoraPty());
    var evs = obtenerEventos();
    if (evs === null) return;
    props.setProperty('SP_LAST_OK', ahoraPty());

    var vistos = leerVistos();
    var nuevos = [];
    evs.forEach(function (e) {
      var v = buscarVisto(vistos, e);
      if (!v) { nuevos.push(e); vistos.push(resumen(e)); }
      else if (e.mag - v.mag >= 0.5) { e.revisado = v.mag; nuevos.push(e); v.mag = e.mag; }  // magnitud revisada al alza
    });
    guardarVistos(vistos);

    var push = nuevos.filter(function (e) { return e.mag >= CFG_SISMOS.PUSH_MIN_MAG; });
    if (push.length) {
      enviarPush(push, false);
      props.setProperty('SP_LAST_SENT', ahoraPty() + ' · ' + nuevos.map(function (e) { return 'M' + e.mag.toFixed(1) + ' ' + e.src; }).join(', '));
    }
  } finally {
    lock.releaseLock();
  }
}

/* ============ fuentes ============ */

function obtenerEventos() {
  var b = CFG_SISMOS.BOX;
  var desde = Utilities.formatDate(new Date(Date.now() - CFG_SISMOS.VENTANA_MIN * 60000), 'UTC', "yyyy-MM-dd'T'HH:mm:ss");
  var q = 'starttime=' + desde + '&minlatitude=' + b.la0 + '&maxlatitude=' + b.la1 + '&minlongitude=' + b.lo0 + '&maxlongitude=' + b.lo1 + '&minmagnitude=2.5';
  var reqs = [
    {url: 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&' + q, muteHttpExceptions: true},
    {url: 'https://www.seismicportal.eu/fdsnws/event/1/query?format=json&' + q, muteHttpExceptions: true}
  ];
  var res;
  try { res = UrlFetchApp.fetchAll(reqs); } catch (err) { return null; }
  var usgs = [], emsc = [], estadoSrc = [];
  if (res[0].getResponseCode() === 200) {
    estadoSrc.push('USGS ok');
    JSON.parse(res[0].getContentText()).features.forEach(function (f) {
      var p = f.properties, g = f.geometry.coordinates;
      usgs.push({src: 'USGS', id: f.id, t: p.time, mag: +p.mag, magType: p.magType || '', lat: g[1], lon: g[0], depth: Math.max(0, +g[2] || 10), place: p.place || '', url: p.url});
    });
  } else estadoSrc.push('USGS ' + res[0].getResponseCode());
  var codeE = res[1].getResponseCode();
  if (codeE === 200) {
    estadoSrc.push('EMSC ok');
    JSON.parse(res[1].getContentText()).features.forEach(function (f) {
      var p = f.properties;
      emsc.push({src: 'EMSC', id: p.unid, t: Date.parse(p.time), mag: +p.mag, magType: p.magtype || '', lat: +p.lat, lon: +p.lon, depth: Math.abs(+p.depth) || 10,
                 place: p.flynn_region || '', url: 'https://www.seismicportal.eu/eventdetails.html?unid=' + p.unid, auth: p.auth || ''});
    });
  } else estadoSrc.push('EMSC ' + (codeE === 204 ? 'sin eventos' : codeE));  // EMSC responde 204 cuando no hay eventos
  PropertiesService.getScriptProperties().setProperty('SP_LAST_SRC', estadoSrc.join(' · '));
  if (res[0].getResponseCode() !== 200 && codeE !== 200 && codeE !== 204) return null;

  // une catálogos: el mismo sismo si difiere ≤20 s, ≤60 km y ≤1 de magnitud; prioridad USGS
  var out = usgs.slice();
  emsc.forEach(function (x) {
    var hit = null;
    for (var i = 0; i < out.length; i++) if (mismoSismo(out[i], x)) { hit = out[i]; break; }
    if (hit) { if (hit.src === 'USGS') { hit.src = 'USGS+EMSC'; hit.emscMag = x.mag; } }
    else out.push(x);
  });
  return out.filter(function (e) { return isFinite(e.mag) && isFinite(e.t); }).sort(function (a, b) { return a.t - b.t; });
}

/* ============ envío ============ */

function enviarPush(evs, prueba) {
  var e = mayor(evs);
  var extra = evs.length > 1 ? ' (+' + (evs.length - 1) + ' más)' : '';
  var cuerpo = lugarEs(e.place) + ' · ' + horaPty(e.t) + ' (Panamá) · Prof. ' + Math.round(e.depth) + ' km · ' + e.src +
    '\nIntensidad estimada Cd. Panamá: ' + romano(mmiAt(e, 8.983, -79.519)) + extra;
  var payload = {
    topic: topicNtfy(),
    title: (prueba ? 'PRUEBA · ' : '') + (e.revisado ? 'Revisado: ' : '') + 'Sismo M' + e.mag.toFixed(1),
    message: cuerpo,
    priority: e.mag >= CFG_SISMOS.URGENTE_MIN_MAG ? 5 : e.mag >= 5 ? 4 : 3,
    click: CFG_SISMOS.APP_URL
  };
  try {
    UrlFetchApp.fetch(CFG_SISMOS.NTFY_SERVER + '/', {method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true});
  } catch (err) { Logger.log('ntfy: ' + err); }
}

/* ============ utilidades ============ */

function topicNtfy() {
  var p = PropertiesService.getScriptProperties();
  var t = p.getProperty('SP_TOPIC');
  if (!t) { t = 'sismos-pa-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12); p.setProperty('SP_TOPIC', t); }  // tema privado difícil de adivinar
  return t;
}
function leerVistos() {
  var s = PropertiesService.getScriptProperties().getProperty('SP_SEEN');
  var arr = s ? JSON.parse(s) : [];
  var lim = Date.now() - 2 * 864e5;
  return arr.filter(function (x) { return x.t > lim; });
}
function guardarVistos(arr) {
  arr = arr.slice(-250);
  PropertiesService.getScriptProperties().setProperty('SP_SEEN', JSON.stringify(arr));
}
function resumen(e) { return {id: e.id, t: e.t, lat: Math.round(e.lat * 1000) / 1000, lon: Math.round(e.lon * 1000) / 1000, mag: e.mag}; }
function buscarVisto(vistos, e) {
  for (var i = 0; i < vistos.length; i++) if (vistos[i].id === e.id || mismoSismo(vistos[i], e)) return vistos[i];
  return null;
}
function mismoSismo(a, b) { return Math.abs(a.t - b.t) <= 20000 && Math.abs(a.mag - b.mag) <= 1 && distKm(a.lat, a.lon, b.lat, b.lon) <= 60; }
function mayor(evs) { return evs.reduce(function (a, e) { return !a || e.mag > a.mag ? e : a; }, null); }
function distKm(la1, lo1, la2, lo2) {
  var r = Math.PI / 180, dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  var a = Math.pow(Math.sin(dLa / 2), 2) + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.pow(Math.sin(dLo / 2), 2);
  return 12742 * Math.asin(Math.sqrt(a));
}
// Intensidad Mercalli Modificada estimada — Atkinson & Wald (2007)
function mmiAt(e, la, lo) {
  var d = distKm(e.lat, e.lon, la, lo), rh = Math.sqrt(d * d + e.depth * e.depth);
  var R = Math.sqrt(rh * rh + 196), lR = Math.log(R) / Math.LN10, B = Math.max(0, Math.log(R / 30) / Math.LN10), x = e.mag - 6;
  var v = 12.27 + 2.270 * x + 0.1304 * x * x - 1.30 * lR - 0.0007070 * R + 1.95 * B - 0.577 * e.mag * lR;
  return Math.max(1, Math.min(10, v));
}
function romano(v) { return ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][Math.round(v)]; }
function lugarEs(s) {
  return String(s || '').replace(/(\d+) km (N|S|E|W|NE|NW|SE|SW|NNE|NNW|SSE|SSW|ENE|ESE|WNW|WSW) of /, function (m, k, d) {
    return k + ' km al ' + d.replace(/W/g, 'O') + ' de ';
  }).replace(', Panama', ', Panamá');
}
function horaPty(t) { return Utilities.formatDate(new Date(t), 'America/Panama', 'HH:mm'); }
function ahoraPty() { return Utilities.formatDate(new Date(), 'America/Panama', 'dd/MM/yyyy HH:mm:ss'); }
