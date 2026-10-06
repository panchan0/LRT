# PROJECT_STATE.md

## 1. Identidad

- Nombre: Raven
- Tipo: Launcher + runtime local universal
- Plataforma principal: Web/PWA, con iPhone/iOS como dispositivo principal de prueba
- Orientación: Adaptativa
- Versión actual: `0.18.0`
- Entrypoint: `index.html`
- Estado: Beta
- Última fase completada: Android Runtime Fase 2 · importación APK + Android Guest Core DEX + bridge host iOS v2, conservando T-OS v1
- Última actualización: 2026-10-06

## 2. Objetivo de esta build

Integrar `.apk` como formato y runtime de primera clase dentro de Raven 0.17.9, sin degradar APK a ZIP/HTML genérico y sin romper el protocolo T-OS ya corregido. La Fase 2 añade inspección Android real, routing propio, Guest Core DEX y el contrato de un host iOS nativo.

La build no declara compatibilidad total con APK Java/Kotlin/NDK: el Guest Core interpreta una parte útil de Dalvik/DEX y prepara el arranque, pero Activity, Android Framework, Binder, Bionic, Surface/GL y el ABI nativo todavía requieren un motor host iOS posterior. Los APK híbridos Cordova/Capacitor sí pueden ejecutarse mediante el WebRuntime de Raven.

## Android Runtime · Fase 2

### Integración en Raven

- `.apk` añadido al selector principal y al flujo de vinculación/actualización.
- `FileImporter` reconoce y valida APK hasta 2 GB.
- `ProjectImporter` crea proyectos `source: "apk"`, `runtimeId: "android"`, `platform: "android"`.
- Identidad estable: `android:<packageName>` cuando el manifest expone package.
- `ProjectStorage` conserva/restaura `runtimeId: "android"` durante carga y migración.
- `ProjectValidator` valida estructura APK y exige DEX o bundle web ejecutable.
- `CompatibilityScanner` distingue Android híbrido, host nativo disponible y Guest Core parcial.
- `RuntimeManager` registra `android` como runtime dedicado.
- RuntimeView expone diagnóstico Android.
- Ajustes > Formatos locales y Compatibilidad muestran APK/Android explícitamente.

### APK Inspector

`RavenAndroidRuntime` implementa lectura ZIP/APK y analiza:

- `AndroidManifest.xml` en XML de texto y AXML binario.
- package name, versionCode, versionName, minSdk y targetSdk.
- launcher Activity.
- `classes.dex` y multidex.
- bibliotecas `lib/<abi>/*.so` y ABI detectadas.
- icono launcher por heurística de recursos.
- bundles Cordova, Capacitor y layouts web conocidos.

### Android Guest Core v0.2

El módulo `raven-android-guest-core.js` añade:

- parser de cabecera y tablas DEX;
- strings, types, protos, fields, methods y class defs;
- lectura de `class_data_item` y `code_item`;
- búsqueda de clases y métodos;
- detección de la clase launcher y `onCreate`;
- intérprete Dalvik básico con registros, constantes, return, saltos, comparaciones, invocaciones y aritmética entera;
- límites de pasos/profundidad para impedir loops sin control;
- stubs iniciales para `android.util.Log` y `java.lang.Math`.

La prueba automatizada construye un DEX mínimo y ejecuta `Ltest/Main;->answer()I`, obteniendo `42`.

### APK híbridos

Cuando se detecta Cordova/Capacitor/web assets, AndroidRuntime extrae el bundle a un VFS temporal y lo entrega al `WebRuntimeAdapter` real de Raven. No se abre el `.apk` como ZIP genérico ni se cambia su identidad de Biblioteca.

### Host iOS v2

Se incluye un scaffold Swift en `android-runtime/native/ios/`:

- `RavenAndroidHost.swift`: `WKScriptMessageHandler` para `raven-android-runtime/v1`.
- `RavenAndroidPackageStore.swift`: transferencia APK por chunks y almacenamiento sandbox.
- `RavenAndroidGuestEngine.swift`: contrato de capacidades, launch/lifecycle y backend explícitamente no soportado por defecto.

El bridge web usa `runtimeId + nonce`, transferencias por sesión y comandos de lifecycle. El engine placeholder responde con `ANDROID_BACKEND_UNAVAILABLE`; no fabrica un READY ni simula que una Activity arrancó.

### Estado real de ejecución Android

- APK híbrido Cordova/Capacitor: implementado por WebRuntime.
- Parsing/diagnóstico DEX: implementado.
- Ejecución de bytecode Dalvik básico aislado: implementado y probado.
- Activity/Android Framework completo: pendiente.
- Binder/services/content providers: pendiente.
- Bionic/JNI/ELF `.so`: pendiente.
- Render Surface/Metal, audio Android y sensores Android: pendiente.
- APK Android nativo arbitrario en iPhone: **no se declara funcional todavía**.

## 3. Implementación encontrada en Raven 0.17.8, antes del cambio

### Componentes localizados

- `tos/TOSPackageReader`: presente dentro de `index.html`.
- `runtime/tos/TOSHostBridge`: presente dentro de `index.html`.
- `runtime/tos/TOSRuntime`: presente dentro de `index.html`.
- `runtime/RuntimeManager`: presente dentro de `index.html`.
- `ui/runtime/RuntimeView`: presente dentro de `index.html`.
- `runtime/HtmlRuntime`, `runtime/RuntimeBridge`, `runtime/SandboxRuntime`: presentes y usados como transporte web-host interno.
- `TOSRuntimeHost`: no existía como módulo/clase independiente en 0.17.8. La función de host estaba repartida entre `TOSRuntime`, `TOSHostBridge`, el bootstrap inyectado y `HtmlRuntime`.
- `MessageChannel`: no se utilizaba para T-OS.

### Flujo real de boot en 0.17.8

1. `TOSRuntime.mount()` validaba el proyecto con `TOSPackageReader.validateProject()`.
2. Leía el HTML del entrypoint de T-OS e inyectaba `BRIDGE_BOOTSTRAP` al comienzo de `<head>`.
3. Creaba un proyecto interno `hosted` con `runtimeId: "web"` únicamente para reutilizar `HtmlRuntime` como transporte.
4. `HtmlRuntime.mount()` construía el documento y creaba el iframe.
5. `HtmlRuntime` configuraba el sandbox (`allow-scripts`, `allow-pointer-lock`, `allow-downloads`, `allow-orientation-lock`).
6. `HtmlRuntime` arrancaba primero su `RuntimeBridge` genérico (`local-web-runtime/v1`).
7. `HtmlRuntime` llamaba `onFrameCreated(iframe)` antes de insertar `srcdoc`.
8. En ese callback, `TOSRuntime` creaba `TOSHostBridge` y llamaba `start()`, que registraba `window.addEventListener('message', ...)`.
9. El iframe era insertado y, tras dos `requestAnimationFrame`, se asignaba `iframe.srcdoc = html`.
10. `HtmlRuntime.mount()` devolvía el iframe inmediatamente después de asignar `srcdoc`.
11. Solo entonces `TOSRuntime` arrancaba el temporizador de 12 s.

### Respuestas a la inspección solicitada

1. Listener de mensajes: se instalaba desde `TOSHostBridge.start()` dentro de `onFrameCreated`, antes de `srcdoc`.
2. Iframe/runtime: lo creaba `HtmlRuntime.mount()` después de `buildDocument()`.
3. Source: se usaba `srcdoc`; no Blob URL para el iframe principal. Los assets internos sí pueden resolverse a Blob URLs por `HtmlRuntime`.
4. Mensaje esperado por Raven 0.17.8: `channel: "tos-runtime/v1"`, `type: "tos.event"`, `event: "runtime.ready"`.
5. Mensaje emitido por el bootstrap Raven 0.17.8: `type: "tos.event"`, `event: "runtime.ready"` cuando una heurística DOM detectaba `#device`, `#shell` y `#device` visible. El archivo real `T-OS-Beta-v0.2.0-beta.2.tos` no estaba incluido en los artefactos disponibles de esta tarea, por lo que no se marcó como verificado el formato exacto del READY emitido por el T-Shell de esa imagen.
6. `event.source`: se exigía igualdad exacta con `iframe.contentWindow`.
7. `event.origin`: no se validaba. Por tanto `origin: "null"` no era rechazado por sí mismo.
8. Canal T-OS: ya existía `tos-runtime/v1`; el WebRuntime genérico usa independientemente `local-web-runtime/v1`.
9. BOOT_TIMEOUT: empezaba después de que `HtmlRuntime.mount()` asignara `srcdoc`, no durante lectura/descompresión del `.tos`.
10. Carrera listener/source: el listener T-OS ya se instalaba antes del `srcdoc`, así que la carrera simple “READY antes de listener” no era el defecto principal observado en el código. Sin embargo no había handshake/reintento y un READY con esquema distinto era descartado definitivamente.

### Defectos reales encontrados

- No existía `runtimeId` por sesión.
- No existía nonce/token de sesión.
- No existía `tos.host.hello`.
- No existía confirmación `tos.bridge.connected`.
- El host aceptaba únicamente `tos.event/runtime.ready`; `tos.event/READY` y `runtime-ready` no eran adaptados.
- El bootstrap de Raven intentaba inferir READY por estructura DOM (`#device/#shell`) en vez de representar formalmente el estado de T-Shell.
- Los mensajes rechazados se descartaban silenciosamente.
- `runtime.error` solo registraba error, pero no detenía inmediatamente el BOOT_TIMEOUT.
- Los estados del runtime se reducían esencialmente a `CREATED`, `STARTING`, `RUNNING`, `SUSPENDED`, `ERROR`, `TERMINATED`.
- El timeout no incluía último estado, etapa ni mensajes recibidos.

## 4. Arquitectura T-OS en 0.17.9

```text
RuntimeManager
├── WebRuntimeAdapter        (sin cambios)
├── GameBoyRuntime           (sin cambios)
├── NESRuntime               (sin cambios)
└── TOSRuntime
    ├── TOSPackageReader
    ├── HtmlRuntime          (solo transporte interno; sin cambios)
    ├── TOSHostBridge
    └── bootstrap T-OS v1 inyectado antes del boot
```

Canal oficial:

```text
tos-runtime/v1
```

Envelope canónico:

```js
{
  channel: "tos-runtime/v1",
  runtimeId: "...",
  nonce: "...",
  type: "...",
  payload: {}
}
```

### Sesión

Cada instancia de `TOSRuntime` genera:

- `runtimeId`: `crypto.randomUUID()` cuando está disponible.
- `nonce`: 24 bytes aleatorios generados con `crypto.getRandomValues()` y serializados en hexadecimal.

Una sesión anterior no puede marcar READY a una sesión nueva porque el bridge exige:

- `event.source === iframe.contentWindow`
- `channel === "tos-runtime/v1"`
- `runtimeId === currentRuntimeId`
- `nonce === currentNonce`

`event.origin` no se usa como frontera de seguridad porque un iframe sandboxed/srcdoc puede producir un origen opaco/null.

## 5. Handshake 0.17.9

Orden:

```text
create TOSRuntime session
→ validate package/project
→ HOST_READY
→ generate runtimeId + nonce
→ create iframe
→ attach TOSHostBridge message listener
→ configure/insert iframe
→ assign srcdoc
→ bootstrap emits tos.bridge.loaded
→ Raven sends tos.host.hello
→ bootstrap replies tos.bridge.connected
→ T-Shell emits/forwards readiness
→ bootstrap/compat adapter yields tos.shell.ready
→ TOSRuntime READY
→ BOOT_TIMEOUT cancelled
```

El bootstrap expone `globalThis.TOSHostBridge` v1 con:

- `hostCapabilities()`
- `close()`
- `request()`
- `bootStage()`
- `coreReady()`
- `shellStarting()`
- `shellReady()`
- `bootError()`

También acepta eventos locales `tos:shell-ready`, `tos:ready`, `tos:boot-stage` y `tos:boot-error` para desacoplar T-Shell del transporte `postMessage`.

### READY temprano

Si `tos.shell.ready` llega antes de que Raven haya enviado `tos.host.hello`, el bridge lo conserva como `pendingReady`. Al enviar hello, se procesa una sola vez. Esto elimina la pérdida del READY sin fingirlo.

### READY duplicado

`acceptReady()` y `TOSRuntime.markReady()` son idempotentes. Un READY duplicado se registra en debug y se ignora sin remount, reinicio ni doble transición.

## 6. Estados implementados

- `CREATED`
- `PACKAGE_VALIDATED`
- `HOST_READY`
- `FRAME_CREATED`
- `FRAME_LOADED`
- `BRIDGE_CONNECTED`
- `CORE_STARTING`
- `SHELL_STARTING`
- `READY`
- `SUSPENDED`
- `ERROR`
- `TERMINATED`

`BOOT_TIMEOUT` mantiene 12 000 ms y ahora reporta:

- último estado real;
- mensaje esperado (`tos.shell.ready`);
- mensajes T-OS recibidos;
- última etapa de boot cuando existe.

## 7. PACKAGE_LOAD_TIMEOUT separado

La importación `.tos` ocurre antes de crear `TOSRuntime` y antes de iniciar BOOT_TIMEOUT. En 0.17.9 `TOSImporter.import()` tiene un `PACKAGE_LOAD_TIMEOUT` independiente de 5 minutos para lectura, descompresión y montaje. El temporizador de boot sigue siendo 12 s y solo se inicia después de asignar el documento del runtime.

## 8. Compatibilidad Beta temporal

Marcada en código como:

```text
LEGACY T-OS BETA COMPATIBILITY
```

Adaptadores admitidos desde el iframe activo:

- `type: "tos.event", event: "READY"`
- `type: "tos.event", event: "runtime.ready"`
- `type: "tos.event", event: "shell.ready"`
- `type: "runtime-ready"`
- request Beta `tos.request` sin envelope de sesión

Los adaptadores se convierten internamente al protocolo canónico. Se registran como legacy en diagnóstico para poder retirarlos posteriormente.

## 9. Logging y rechazo explícito

Ejemplos actuales:

```text
[TOSRuntime] Session created: <runtimeId>
[TOSRuntime] message listener attached
[TOSRuntime] state → FRAME_CREATED
[TOSRuntime] frame load event
[TOSBridge] → tos.host.hello
[TOSBridge] ← tos.bridge.connected
[TOSBridge] ← tos.boot.stage
[TOSBridge] ← tos.shell.ready
[TOSRuntime] READY accepted
[TOSRuntime] boot completed in <ms>ms
```

Rechazos se registran con razón:

- `unexpected source`
- `unexpected channel`
- `invalid runtimeId`
- `invalid nonce`
- `missing session credentials`

## 10. Diagnóstico visual

En el menú `⋯` de un runtime T-OS aparece `T-OS · Diagnóstico`.

Muestra:

- TOSRuntime
- Package
- System manifest
- TOS frame
- Host bridge
- T-Core
- T-Shell
- READY handshake
- State
- Bridge version
- Boot ms / tiempo transcurrido
- Last message
- Last stage
- Mensajes rechazados, si existen

## 11. Regresión Web/ROM

Comparación de 0.17.8 → 0.17.9 realizada por hash de los módulos extraídos de `index.html`:

- `runtime/messages`: UNCHANGED
- `runtime/RuntimeBridge`: UNCHANGED
- `runtime/SandboxRuntime`: UNCHANGED
- `runtime/HtmlRuntime`: UNCHANGED
- `runtime/WebRuntimeAdapter`: UNCHANGED
- `runtime/GameBoyRuntime`: UNCHANGED
- `runtime/NESRuntime`: UNCHANGED

`RuntimeManager` solo recibió el passthrough `getDiagnostics()` y `RuntimeView` el acceso visual al diagnóstico T-OS.

## 12. Pruebas automatizadas ejecutadas

Archivo: `tests/tos-runtime-v1.test.js`

Resultado local Node.js:

- TEST 1 READY normal: PASS
- TEST 2 READY antes de host.hello: PASS
- TEST 3 host.hello antes de READY: PASS
- TEST 4 READY duplicado: PASS
- TEST 5 runtimeId incorrecto: PASS
- TEST 6 nonce incorrecto: PASS
- TEST 7 otro iframe: PASS
- TEST 8 nunca llega READY → BOOT_TIMEOUT: PASS
- TEST 9 `tos.boot.error` falla inmediatamente: PASS
- TEST 10 cerrar/abrir crea sesión nueva: PASS
- Compatibilidad Beta `tos.event/READY`: PASS

Total: 11/11 PASS.

## 13. Prueba real T-OS Beta

Estado: **NOT TESTED en esta build de trabajo**.

Motivo: el único archivo T-OS solicitado para esta validación, `T-OS-Beta-v0.2.0-beta.2.tos`, no estaba incluido dentro de `Raven-v0.17.8-offline-deploy(1).zip` ni disponible entre los archivos recuperables de esta tarea. No se creó un mock para fingir este criterio.

Pendiente exacto cuando se disponga del archivo real:

```text
Importar T-OS-Beta-v0.2.0-beta.2.tos
→ Abrir
→ confirmar tos.bridge.loaded
→ confirmar tos.host.hello
→ confirmar tos.bridge.connected
→ observar mensaje READY real de T-Shell
→ confirmar adaptación/canonical tos.shell.ready
→ confirmar state READY
→ confirmar cancelación del BOOT_TIMEOUT
→ confirmar Lock Screen
→ cerrar
→ abrir nuevamente
→ confirmar runtimeId/nonce nuevos
```

## 14. Problemas conocidos

### P0

- [ ] Validación física del flujo completo con `T-OS-Beta-v0.2.0-beta.2.tos` real en Safari/iPhone.

### P1

- [ ] Retirar `LEGACY T-OS BETA COMPATIBILITY` cuando todas las imágenes T-OS emitan el envelope v1 canónico.

## 15. Criterios de aceptación

- [x] TOSRuntime registra listener antes del boot/srcdoc.
- [x] Raven envía `tos.host.hello`.
- [x] Bootstrap T-OS v1 responde `tos.bridge.connected`.
- [x] `tos.shell.ready` es reconocido de forma canónica.
- [x] READY cambia el estado a `READY`.
- [x] READY cancela BOOT_TIMEOUT.
- [x] READY duplicado es idempotente.
- [x] Sesión vieja no puede marcar nueva sesión como READY.
- [x] `boot.error` termina el boot inmediatamente.
- [x] Timeout conserva 12 s.
- [x] PACKAGE_LOAD_TIMEOUT y BOOT_TIMEOUT están separados.
- [x] Errores muestran estado/mensajes/etapa.
- [x] WebRuntime/HTML/ZIP no fue modificado internamente.
- [x] GB/GBC/NES no fueron modificados internamente.
- [ ] Lock Screen confirmado con el `.tos` real solicitado.
- [ ] Cerrar/abrir confirmado en el `.tos` real solicitado (la nueva sesión sí está cubierta por test automatizado).
