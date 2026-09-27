Raven 0.17.2 — Offline Deploy

Sube el CONTENIDO de esta carpeta a la misma carpeta pública de GitHub Pages:
- index.html
- raven-sw.js
- manifest.webmanifest
- raven-icon.jpg

No subas solamente el ZIP esperando que GitHub Pages lo extraiga.

Raven Files 0.17.2 conserva la estructura de subcarpetas del directorio vinculado. Los archivos sueltos permanecen en la raíz; las carpetas y subcarpetas se navegan dentro de Raven. En iPhone/iPad, Raven guarda localmente los archivos compatibles y reconstruye la jerarquía a partir de sus rutas relativas. Las carpetas vacías no pueden reconstruirse con webkitdirectory si Safari no entrega ninguna entrada dentro de ellas.

Abre Raven al menos una vez con conexión después de desplegar una versión nueva para que el Service Worker guarde el shell 0.17.2.

Raven UI System v2 unifica Inicio, Biblioteca, Detalle y Configuración con tokens visuales, navegación compacta, búsqueda/orden/filtros y menús bottom sheet sin alterar la biblioteca persistente ni el runtime.


Raven Files 0.17.2 elimina el tope fijo de 512 MB para la copia local. Raven consulta la cuota real del navegador/dispositivo y puede usar varios GB cuando el sistema los concede. Si la API de cuota no está disponible, se usa un respaldo de 8 GB. La UI de Configuración muestra la cuota disponible cuando el navegador la informa.

Raven UI System v2 0.17.2 corrige el scroll táctil de las pantallas principales, normaliza iconos y carátulas en la cuadrícula y corrige el dock/FAB en landscape para que no invadan el contenido.
