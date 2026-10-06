# QA_CHECKLIST.md

## 1. Identificación

- Proyecto: Raven
- Versión: 0.18.0
- Fecha: 2026-10-06
- Entorno: análisis estático + Node.js + `swiftc -parse`; Chromium headless disponible pero no completó el smoke test dentro del límite del entorno
- Base: Raven 0.17.9 TOS-BOOT-FIX
- Tester: IA

## 2. Android Runtime · Fase 2

| Prueba | Estado | Notas |
|---|---|---|
| Reconocer `.apk` | PASS | `FileImporter.isApk` + routing de `ProjectImporter` |
| Leer APK ZIP/DEFLATE | PASS | fixture híbrido |
| AndroidManifest XML texto | PASS | test core |
| AndroidManifest AXML binario | PASS | fixture AXML generado en test |
| package/version/launcher | PASS | `com.raven.hybrid`, versión 1.2, `.MainActivity` |
| Identidad estable Android | PASS | `android:com.raven.hybrid` |
| Detectar DEX | PASS | DEX 039 |
| Detectar ABI nativa | PASS | fixture `arm64-v8a` |
| Detectar Cordova | PASS | `assets/www/index.html` |
| Import metadata `runtimeId: android` | PASS | test core |
| Android Guest Core parse DEX | PASS | 1 clase / 1 método fixture |
| Android Guest Core ejecutar bytecode | PASS | `answer()I` devuelve `42` |
| Clasificar híbrido | PASS | `tier: hybrid-web`, runnable |
| Clasificar NDK | PASS | `tier: native-host`, no se finge runnable |
| Sources JS Android | PASS | `node --check` |
| Swift host scaffold | PASS | `swiftc -parse` |
| Registro Android en RuntimeManager | PASS estático | integración presente antes de `main` |
| APK híbrido montado en Raven real | NOT TESTED | smoke Chromium headless no finalizó en este entorno |
| APK Java/Kotlin Activity en iPhone | NOT IMPLEMENTED | requiere Framework/Binder/Bionic/Surface host |
| APK NDK `.so` en iPhone | NOT IMPLEMENTED | requiere ABI/JNI/Bionic |

Resultado automatizado del core Android: **PASS**.

## 3. T-OS Runtime v1 · regresión

| Prueba | Estado | Notas |
|---|---|---|
| READY normal | PASS | TEST 1 |
| READY antes de hello | PASS | TEST 2 |
| hello antes de READY | PASS | TEST 3 |
| READY duplicado | PASS | TEST 4 |
| runtimeId incorrecto | PASS | TEST 5 |
| nonce incorrecto | PASS | TEST 6 |
| otro iframe | PASS | TEST 7 |
| T-Shell nunca responde | PASS | TEST 8, BOOT_TIMEOUT real |
| `tos.boot.error` | PASS | TEST 9 |
| cerrar/abrir crea sesión nueva | PASS | TEST 10 |
| Legacy `tos.event/READY` | PASS | compatibilidad Beta |

Resultado automatizado: **11/11 PASS** después de integrar Android.

## 4. Sintaxis / empaquetado

| Prueba | Estado | Notas |
|---|---|---|
| 6 scripts inline de `index.html` | PASS | reextraídos de la build final + `node --check` |
| `raven-android-runtime.js` | PASS | `node --check` |
| `raven-android-guest-core.js` | PASS | `node --check` |
| `raven-android-integration.js` | PASS | `node --check` |
| Manifest JSON | PASS | parse JSON |
| Service worker | PASS | versión 0.18.0 |
| Swift host | PASS | parse de los 3 archivos |

## 5. Persistencia / actualización

- [x] APK usa `source: apk` y `runtimeId: android`.
- [x] La carga desde IndexedDB restaura Android por source si falta runtimeId.
- [x] La migración `currentBuild` conserva/infiere Android en vez de degradar a web.
- [x] La actualización sigue usando el pipeline transaccional de Raven.
- [x] No se modificó la lógica de sesión T-OS.

## 6. Limitaciones conocidas

- El `Android Guest Core` no es ART completo.
- El intérprete Dalvik cubre un subconjunto inicial de opcodes.
- El host Swift incluido es un contrato/scaffold, no una implementación de Android Framework.
- El backend por defecto falla explícitamente con `ANDROID_BACKEND_UNAVAILABLE`; esto es intencional para evitar compatibilidad fingida.
- El smoke test browser completo no pudo cerrarse en Chromium headless de este entorno y se mantiene `NOT TESTED`.
- Prueba en Safari/iPhone real: `NOT TESTED`.

## 7. Próxima fase recomendada

**Android Guest Phase 3:** Runtime Object Model + Activity lifecycle + framework stubs (`Context`, `Activity`, `Bundle`, `View`) y una primera Surface bridge renderizable en iOS. Después: JNI/Bionic/ELF para APK NDK.

## 8. Resultado final

- Estado de build: **PARCIAL / TESTABLE**
- P0 introducidos conocidos: ninguno en pruebas estáticas/core.
- Regresión T-OS: 11/11 PASS.
- Android híbrido: core/routing implementado; montaje browser real pendiente de dispositivo/navegador estable.
- Android nativo arbitrario: no terminado y no declarado funcional.
