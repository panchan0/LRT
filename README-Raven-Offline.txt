Raven 0.17.8 — Offline Deploy

Sube el CONTENIDO de esta carpeta a la misma carpeta pública de GitHub Pages:
- index.html
- raven-sw.js
- manifest.webmanifest
- raven-icon.jpg

No subas solamente el ZIP esperando que GitHub Pages lo extraiga.

Raven Files 0.17.8 conserva la estructura de subcarpetas del directorio vinculado. Los archivos sueltos permanecen en la raíz; las carpetas y subcarpetas se navegan dentro de Raven. En iPhone/iPad, Raven guarda localmente los archivos compatibles y reconstruye la jerarquía a partir de sus rutas relativas. Las carpetas vacías no pueden reconstruirse con webkitdirectory si Safari no entrega ninguna entrada dentro de ellas.

Abre Raven al menos una vez con conexión después de desplegar una versión nueva para que el Service Worker guarde el shell 0.17.8.

UI: Raven UI System v2


0.17.5: conserva exactamente la interfaz visual de 0.17.4/V1 y endurece la estabilidad de actualización. Raven verifica el conjunto de archivos ya persistido antes de declarar éxito, conserva preferencias futuras/desconocidas de cada app, guarda la identidad visual dentro del journal de actualización, repara una actualización interrumpida al reiniciar y revierte automáticamente a la revisión anterior si la verificación final falla y existe una revisión segura.

0.17.6: mantiene la interfaz V1/0.17.5 y vuelve funcional Configuración. Los 18 accesos principales abren apartados reales; Apariencia incluye Raven, Midnight, Aurora, Nocturne, Ember y Graphite; densidad, color ambiental, gestos, movimiento y módulos de Inicio se guardan en raven-ui-preferences-v3. Se conservan íntegramente las mejoras transaccionales y de recuperación de 0.17.5.


0.17.7: añade actualización automática de fuentes. Raven compara las apps de Biblioteca con sus archivos vinculados al iniciar, al volver a Raven y cada 30 segundos mientras la app está visible. Si el navegador conserva un FileSystemDirectoryHandle con permiso de lectura, Raven relee directamente la carpeta seleccionada y actualiza en segundo plano cualquier archivo cuyo contenido cambió. Las actualizaciones automáticas reutilizan el mismo pipeline transaccional de 0.17.5/0.17.6, por lo que conservan nombre, icono, carátula, portada, preview, historial y rollback.

En iPhone/iPad, cuando Safari solo ofrece webkitdirectory, la selección es una copia local y no un permiso permanente sobre la carpeta externa. En ese modo Raven no puede saltarse el sandbox de iOS: al volver a seleccionar/refrescar la misma carpeta, Raven compara todos los archivos y actualiza automáticamente todas las apps coincidentes, sin tener que entrar una por una a “Actualizar archivo”. Cuando existe acceso persistente al directorio, la vigilancia sí funciona sin volver a seleccionarlo.

0.17.8: primer milestone nativo de T-OS (Fases A+B). Raven reconoce .tos como imagen de sistema T-OS y .tapp como paquete de aplicación T-OS. Las imágenes .tos pasan por TOSPackageReader, se validan antes de instalar, aparecen en Biblioteca como formato TOS y arrancan mediante el runtime dedicado TOSRuntime. La build real T-OS 0.1.0 fue probada hasta T-Core/T-Shell y puede cerrarse para volver a Raven. Los .tapp se reconocen y validan, pero su instalación pertenece a la Fase F y por ahora Raven muestra un error explícito en lugar de abrirlos con Web Runtime.
