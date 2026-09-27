Raven 0.17.6 — Offline Deploy

Sube el CONTENIDO de esta carpeta a la misma carpeta pública de GitHub Pages:
- index.html
- raven-sw.js
- manifest.webmanifest
- raven-icon.jpg

No subas solamente el ZIP esperando que GitHub Pages lo extraiga.

Raven Files 0.17.6 conserva la estructura de subcarpetas del directorio vinculado. Los archivos sueltos permanecen en la raíz; las carpetas y subcarpetas se navegan dentro de Raven. En iPhone/iPad, Raven guarda localmente los archivos compatibles y reconstruye la jerarquía a partir de sus rutas relativas. Las carpetas vacías no pueden reconstruirse con webkitdirectory si Safari no entrega ninguna entrada dentro de ellas.

Abre Raven al menos una vez con conexión después de desplegar una versión nueva para que el Service Worker guarde el shell 0.17.6.

UI: Raven UI System v2


0.17.5: conserva exactamente la interfaz visual de 0.17.4/V1 y endurece la estabilidad de actualización. Raven verifica el conjunto de archivos ya persistido antes de declarar éxito, conserva preferencias futuras/desconocidas de cada app, guarda la identidad visual dentro del journal de actualización, repara una actualización interrumpida al reiniciar y revierte automáticamente a la revisión anterior si la verificación final falla y existe una revisión segura.

0.17.6: mantiene la interfaz V1/0.17.5 y vuelve funcional Configuración. Los 18 accesos principales abren apartados reales; Apariencia incluye Raven, Midnight, Aurora, Nocturne, Ember y Graphite; densidad, color ambiental, gestos, movimiento y módulos de Inicio se guardan en raven-ui-preferences-v3. Se conservan íntegramente las mejoras transaccionales y de recuperación de 0.17.5.
