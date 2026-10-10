# Sismos Panamá

PWA instalable para seguir sismos y réplicas en Panamá: qué esperar, cómo se siente en tu zona y qué hacer. Datos de USGS ComCat y EMSC (este último también en tiempo real).

**No es un sistema oficial de alerta.** Ante un sismo sigue a SINAPROC y al Instituto de Geociencias (IGC) de la Universidad de Panamá.

App: https://diegobethancourth.github.io/sismos-panama/

## Pantallas
- **Inicio**: nivel de actividad, qué esperar (probabilidades en palabras), últimos sismos, ritmo de réplicas interactivo y cómo se siente en tu ciudad (ubicación con permiso o elegida a mano). Compartir por WhatsApp.
- **Mapa**: intensidad estimada y epicentros (24 h / 7 días), resumen y lista; capas técnicas (densidad, ShakeMap y "¿Lo sintió?" de USGS) en el selector del mapa.
- **Qué hacer**: acciones del momento, guía durante/después, mochila de emergencia (se guarda en el teléfono) y números de emergencia.
- **Análisis**: réplicas y ley de Omori, pronóstico completo (con el oficial de USGS si existe), actividad previa, intensidad por ciudad, tabla de eventos con filtros y Excel, y fórmulas.

## Modelos
Omori-Utsu (MLE de Ogata 1983 con prior en p, Page et al. 2016) · Gutenberg-Richter (Aki 1965) · pronóstico Reasenberg & Jones (1989) · ley de Båth · intensidad Atkinson & Wald (2007) · radio de secuencia Wells & Coppersmith (1994).

## Alertas
- **Dentro de la app (recomendado):** botón de campana → elegir umbral → permitir. Con el servicio `push/worker.js` (Cloudflare Worker gratuito) llegan con la app cerrada. Instalación: `push/LEEME.md`; luego poner su URL en `CFG.pushApi` de `index.html`.
- **ntfy (respaldo personal):** `alertas/alertas_sismos.gs` en Apps Script; ver `alertas/LEEME.md`.

## Archivos
`index.html` (app), `sw.js` (caché, push, revisión periódica), `manifest.json`, `icons/`, `data/snapshot.json` (respaldo sin conexión), `push/` (servidor de notificaciones), `alertas/` (respaldo ntfy).
