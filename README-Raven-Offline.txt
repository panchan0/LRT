Raven v0.14.17

GitHub Pages / hosting estático:
1. Sube index.html, raven-sw.js, manifest.webmanifest y raven-icon.jpg a la misma carpeta.
2. Abre Raven una vez con Internet para que el Service Worker guarde el shell local.
3. Después de que la página termine de cargar, Raven puede volver a iniciar sin conexión desde esa instalación/origen.
4. Al actualizar Raven, reemplaza estos archivos. El Service Worker usa una caché versionada y limpia shells anteriores al activarse.

Nota: proyectos importados que dependan de APIs/servidores externos seguirán necesitando esas conexiones. Raven no descarga dependencias npm automáticamente en la ruta offline-first.
