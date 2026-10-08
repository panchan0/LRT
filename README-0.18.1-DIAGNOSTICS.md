# Raven v0.18.1 — Fiabilidad de actualización y diagnóstico local

## Qué se cambió

- Configuración > Diagnóstico y Configuración > Consola muestran eventos técnicos locales de Raven, no solo comprobación estática de APIs.
- Captura de `window.error`, `unhandledrejection`, `console.warn`, `console.error`, errores y avisos de ErrorCollector, fallos de lectura de Biblioteca y etapas de actualización.
- Cada evento incluye fecha ISO, gravedad, categoría, descripción, excepción (`name`, `message`, `stack`, `cause` cuando existe) y datos de contexto; no se envían a un servidor.
- Registro local de un máximo de 140 eventos en `localStorage`; se conserva tras recargar si el navegador mantiene ese almacenamiento.
- Copiar JSON, descargar archivo `.json`, copiar evento individual, filtrar por gravedad, borrar registro (solo registro), comprobar archivos, refrescar.
- El JSON incluye versión, entorno, estimación de cuota/uso cuando está disponible, biblioteca resumida, runtime activo y últimos errores de actualización.
- `Comprobar archivos` revisa de forma explícita el Blob de inicio y las imágenes ya cargadas de hasta 40 aplicaciones. Sólo lee muestras pequeñas; no modifica partidas, assets ni otras entradas. Registra el nombre de juego y la excepción.
- El guardado de actualizaciones grandes evita cargar desde IndexedDB los blobs anteriores solo para averiguar sus claves. Para builds anteriores de más de 24 MiB se omite la duplicación en el historial de versiones a fin de limitar la presión de memoria/espacio. La transacción de app+archivos se conserva.
- Un HTML de inicio muy grande (>24 MiB) no se reconstruye entero en un runtime adicional durante el preflight, evitando su duplicación en memoria. Sí se validan formato, existencia y lectura de muestras del archivo, y la validación previa normal sigue ejecutándose. Esto NO equivale a una prueba de ejecución del HTML completo.
- La verificación posterior al guardado comprueba que una muestra del Blob de inicio sea realmente legible desde IndexedDB, para detectar referencias de Blob inválidas de Safari.
- Si la lectura de biblioteca falla, se conserva la última lista en memoria en vez de mostrar inmediatamente una biblioteca falsa vacía. El error real queda registrado.
- El aviso obsoleto de error se archiva al entrar en Inicio/Configuración, sin borrar el registro técnico.
- La versión de shell PWA, manifest y service worker se sincronizó a 0.18.1.

## Cómo probar en iPhone

1. Haz una copia del directorio y no borres datos de Safari ni aplicaciones de Raven. Instala Raven 0.18.1 sobre el mismo origen que 0.18.0. Si el PWA mantiene el shell anterior, recarga cuando el nuevo service worker haya tomado control.
2. Entra a Configuración > Diagnóstico y pulsa **Comprobar archivos**. Si aparece `NotFoundError`, `storage.entrypoint` o `storage.artwork`, copia o exporta el reporte.
3. Intenta actualizar Superhumanos con el nuevo HTML/ZIP y observa las etapas. Comprueba si cambia a la versión deseada, si inicia y si preserva progreso e imágenes.
4. Si falla, entra a Configuración > Diagnóstico > **Copiar JSON** y envía el contenido. El reporte NO contiene el contenido binario de archivos ni partidas, pero SÍ puede incluir nombres, rutas, identificadores y stack traces. Revísalo antes de compartirlo.
5. Verifica reiniciando la aplicación y cerrando/reabriendo Safari. No elimines la entrada del juego durante el diagnóstico.

## Limitaciones y estado real

- La raíz exacta del `NotFoundError` visto en iPhone 0.18.0 aún NO está demostrada. Puede depender de blobs de Safari, disponibilidad de disco, daños previos, cuota o lógica de actualización. La nueva herramienta busca evidencias reales por etapa.
- Un commit atómico abortado debe conservar los datos viejos, pero una versión grande sin revisión histórica no ofrece la misma capacidad de rollback tras un commit ya confirmado. Si falla la verificación posterior en ese caso, se informa el fallo para inspección y recuperación manual. No se debe eliminar contenido automáticamente.
- No se probó actualización real de Superhumanos de 38-47 MiB en iPhone/iOS dentro de este entorno.
- El `HTML` puede funcionar independientemente; funciones PWA de instalación/service worker necesitan HTTPS.
- El backend nativo Android en iOS sigue incompleto según el estado heredado de la fase P2. Ninguna capacidad APK nativa nueva se declara en este parche.

## Archivos modificados

- `index.html`: cambios in-line para permitir el uso standalone; añadido el diagnóstico y cambios de actualización.
- `diagnostics-raven-v0181.js`: fuente mantenible del módulo integrado en `index.html`.
- `diagnostics-style.css`: estilos mantenibles integrados en `index.html`.
- `raven-sw.js`, `manifest.webmanifest`: versión del shell.
- `tests/diagnostics-unit.test.cjs` y `tests/diagnostics-smoke.html`.
- `PROJECT_STATE.md` y `QA_CHECKLIST.md`: estado actualizado.

