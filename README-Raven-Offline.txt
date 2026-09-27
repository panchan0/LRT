Raven 0.16.4 — Offline Deploy

Sube el CONTENIDO de esta carpeta a la misma carpeta pública de GitHub Pages:
- index.html
- raven-sw.js
- manifest.webmanifest
- raven-icon.jpg

No subas solamente el ZIP esperando que GitHub Pages lo extraiga.

Raven Files 0.16.4 conserva la estructura de subcarpetas del directorio vinculado. Los archivos sueltos permanecen en la raíz; las carpetas y subcarpetas se navegan dentro de Raven. En iPhone/iPad, Raven guarda localmente los archivos compatibles y reconstruye la jerarquía a partir de sus rutas relativas. Las carpetas vacías no pueden reconstruirse con webkitdirectory si Safari no entrega ninguna entrada dentro de ellas.

Abre Raven al menos una vez con conexión después de desplegar una versión nueva para que el Service Worker guarde el shell 0.16.4.
