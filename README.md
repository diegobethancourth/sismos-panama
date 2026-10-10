# Monitor Sísmico Panamá

PWA instalable que sigue en casi tiempo real los sismos de Panamá y su región (USGS ComCat + EMSC, este último también en tiempo real por WebSocket), estima la intensidad sentida en el país y calcula un pronóstico probabilístico de réplicas.

**No es un sistema oficial de alerta.** Ante un sismo sigue a SINAPROC y al Instituto de Geociencias (IGC) de la Universidad de Panamá.

## Qué muestra
- **Mapa** (Leaflet + OpenStreetMap): epicentros por magnitud y antigüedad, área de la secuencia y mapa de calor de **intensidad estimada (MMI)** — todos los sismos, solo el principal, o densidad de epicentros. Si USGS publica ShakeMap y reportes "¿Lo sintió?" se añaden como capas.
- **Réplicas**: magnitud vs. tiempo, tasa por hora frente a la ley de Omori ajustada y relación Gutenberg-Richter.
- **Qué esperar**: probabilidad de al menos una réplica M≥5, 6 y 7 en 6 h, 24 h, 7 y 30 días, con número esperado y rango 95 %. Incluye el pronóstico oficial de USGS (OAF) cuando existe.
- **Antes del sismo**: actividad en los 60 días previos comparada con el año anterior.
- **Ciudades**: intensidad estimada en 15 ciudades.
- Tabla ordenable, filtros, exportación a Excel, tema claro/oscuro, tutorial y notificaciones.

## Modelos
| Componente | Referencia |
|---|---|
| Decaimiento de réplicas | Omori-Utsu, MLE de Ogata (1983), c fijo y prior en p (Page et al. 2016) |
| Distribución de magnitudes | Gutenberg-Richter, estimador b de Aki (1965) |
| Pronóstico | Reasenberg & Jones (1989); marco operativo USGS (Michael et al. 2020) |
| Mayor réplica | Ley de Båth (1965) |
| Intensidad | Atkinson & Wald (2007) |
| Radio de la secuencia | Wells & Coppersmith (1994) |

La pestaña "Cómo se calcula" de la app muestra las fórmulas con los valores actuales.

## Despliegue
GitHub Pages desde `main` (raíz). Archivos: `index.html`, `manifest.json`, `sw.js`, `icons/`, `favicon.ico`, `data/snapshot.json` (respaldo sin conexión).

## Fuentes y marca de actualización
- **USGS** (consulta cada 60 s) es el catálogo de los modelos. **EMSC** agrega redes regionales y llega antes; sus eventos se emparejan con USGS (≤60 s, ≤100 km, ≤1 de magnitud) y los que solo reporta EMSC se marcan aparte.
- El encabezado muestra la hora de la última consulta exitosa de cada fuente, su último sismo y la versión de la app. Cuando se publica una versión nueva aparece el aviso *Recargar*.
- El IGC (Universidad de Panamá) no publica un servicio de datos consultable; se integrará si lo habilita.

## Alertas
Mientras la app está abierta revisa USGS cada 60 s y notifica eventos sobre el umbral elegido (M≥4.5 / 5 / 6). Con la app instalada en Chrome Android se registra además una revisión periódica en segundo plano (el sistema decide la frecuencia, mínimo ~15 min). Para avisos con la app cerrada usa `alertas/` (Apps Script → correo + push ntfy cada minuto); ver `alertas/LEEME.md`.
