# Notificaciones push dentro de la app (Cloudflare Worker)

Con esto cualquier persona recibe alertas tocando **Activar alertas** en la app: sin instalar ntfy, sin cuentas.
`worker.js` revisa cada minuto el Instituto de Geociencias (IGC-UP, red nacional, el más rápido para Panamá), USGS y EMSC, y envía Web Push a los teléfonos suscritos. También entrega a la app el listado del IGC (ruta `/igc`), que su página no permite leer directamente desde otro sitio.

- **Android (Chrome):** funciona con la app abierta, cerrada o instalada.
- **iPhone (iOS 16.4 o más):** solo si la app está instalada en la pantalla de inicio (Compartir → Agregar a inicio). La app lo explica.

## Instalación (15 minutos, una sola vez)
1. Crea una cuenta gratuita en [dash.cloudflare.com](https://dash.cloudflare.com).
2. **Storage & Databases → KV → Create namespace** → nombre `sismos`.
3. **Workers & Pages → Create → Create Worker** → nombre `sismos-push` → *Deploy*.
4. Abre el Worker → **Edit code** → borra todo, pega `push/worker.js` completo → *Deploy*.
5. **Settings → Bindings → Add → KV namespace** → *Variable name* `SISMOS` (mayúsculas) → namespace `sismos` → *Save*.
6. **Settings → Triggers → Cron Triggers → Add** → `* * * * *` (cada minuto) → *Save*.
7. Abre `https://sismos-push.<tu-subdominio>.workers.dev/vapid` en el navegador: debe mostrar `{"key":"B…"}`. Las claves se generan solas la primera vez y quedan en tu KV.
8. Pásame esa URL (o ponla tú en `index.html`, `CFG.pushApi`) y queda conectado.

Verificación: `…/status` muestra la última consulta, las fuentes, la última alerta enviada y `lastBatch` (cuántos teléfonos recibieron el último envío y qué código respondió el servicio de push: `201` = entregado a Google/Apple/Mozilla; `403`/`400` = rechazado; `410` = suscripción vencida, se borra sola).

Prueba por teléfono: en la app, campana → **Probar alerta desde el servidor**. El servidor manda un push real a ese teléfono y la app muestra qué pasó (no registrado / rechazado / aceptado). Si fue aceptado y no aparece «Prueba recibida ✓», el bloqueo está en los ajustes del teléfono.

Cada vez que cambie `worker.js` hay que volver a pegarlo en Cloudflare (**Edit code** → pegar → **Deploy**).

## Capacidad
Cada persona con la app abierta consulta `/igc` una vez por minuto: el plan gratuito (100 000 consultas al día) alcanza para unas 60–70 personas mirando la app todo el día; el de pago, para millones.

| Plan | Envíos por minuto | Costo |
|---|---|---|
| Gratuito | ~45 teléfonos por minuto (si hay más, sigue al minuto siguiente) | 0 |
| Workers Paid | miles por minuto (variable `PUSH_BUDGET` = 5000) | 5 USD/mes |

Si el enlace se comparte mucho y `/status` muestra `"pending": true` seguido, conviene pasar al plan de pago y definir `PUSH_BUDGET` en **Settings → Variables**.

## Revertir
Borra el Cron Trigger (deja de enviar) o el Worker completo. La app sigue funcionando; solo deja de recibir alertas con la app cerrada.
