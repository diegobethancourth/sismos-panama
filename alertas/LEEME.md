# Alertas por correo y push (sin la app abierta)

`alertas_sismos.gs` es un script de Google Apps Script que revisa USGS y EMSC **cada minuto** y, si hay un sismo nuevo en la región de Panamá:

- **Push al teléfono** vía [ntfy](https://ntfy.sh) desde M≥4.5 — suena como cualquier notificación, con la app cerrada.
- **Correo HTML** desde tu Gmail desde M≥5.0, con intensidad estimada por ciudad y enlace al monitor.

No avisa dos veces el mismo sismo aunque llegue por las dos fuentes; sí avisa si la magnitud se revisa al alza ≥0.5.

## Instalación (10 minutos)
1. Entra a [script.google.com](https://script.google.com) con tu cuenta **personal** → *Nuevo proyecto* → nómbralo `Alertas Sismos Panamá`.
2. Pega todo `alertas_sismos.gs` en `Código.gs` y guarda.
3. Ajusta arriba `CFG_SISMOS` si quieres: `EMAILS` (varios separados por coma), `EMAIL_MIN_MAG`, `PUSH_MIN_MAG`.
4. Selecciona la función **`instalar`** → *Ejecutar* → acepta los permisos (Gmail para enviar, conexión externa para leer USGS/EMSC, triggers).
5. Llega un correo **[PRUEBA]** y en *Registro de ejecución* aparece el tema ntfy, p. ej. `sismos-pa-3f9c1a…`.
6. En el teléfono instala **ntfy** (Play Store / App Store) → **+** → escribe ese tema → *Suscribirse*. Vuelve a ejecutar `probarAlerta` para confirmar que suena.

## Mantenimiento
| Función | Para qué |
|---|---|
| `estado` | Última corrida, fuentes que respondieron, último envío |
| `probarAlerta` | Prueba correo + push |
| `desinstalar` | Detiene las alertas (borra el trigger) |

**Revertir:** ejecutar `desinstalar` o borrar el proyecto. No toca nada más de tu cuenta.

## Cuotas (cuenta Gmail gratuita)
- Trigger de 1 min = 1 440 corridas/día; cada corrida hace 2 consultas en paralelo (~1–2 s) → ~25–50 min de los 90 min diarios de triggers.
- Correos: límite 100 destinatarios/día; con el umbral M≥5 una secuencia intensa genera decenas, no cientos.
- El tema ntfy es privado por ser difícil de adivinar; quien lo conozca puede suscribirse (útil para familia).
