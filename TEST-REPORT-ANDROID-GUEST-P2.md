# TEST REPORT · Raven Android Guest Phase 2

Build: `0.18.0`  
Base: `0.17.9 TOS-BOOT-FIX`  
Fecha: 2026-10-06

## Resultado

La Fase 2 está integrada y el núcleo Android pasa sus pruebas automatizadas. La regresión T-OS permanece en 11/11 PASS. La ejecución completa de APK Android nativos no se declara terminada.

## Comandos ejecutados

- `node tests/android-runtime-core-v2.test.cjs` → PASS
- `node tests/android-guest-core-v2.test.js` → PASS
- `node tests/tos-runtime-v1.test.js` → 11/11 PASS
- `node --check` sobre los tres módulos Android → PASS
- extracción de los 6 scripts inline finales + `node --check` → PASS
- parse JSON de `manifest.webmanifest` → PASS
- `swiftc -parse android-runtime/native/ios/*.swift` → PASS

## Evidencia funcional del Guest Core

El fixture DEX generado por la prueba contiene `Ltest/Main;->answer()I`. `DexFile` localiza la clase/método/code item y `DexInterpreter` ejecuta las instrucciones `const/16 v0, 42` y `return v0`. Resultado observado: `42`.

El fixture híbrido se clasifica como `hybrid-web` y el fixture con `lib/arm64-v8a/*.so` como `native-host`, por lo que el runtime no confunde un APK NDK con una aplicación web.

## Smoke browser

Se preparó `tests/browser-smoke.html` para cargar Raven, importar el APK híbrido y montar `RuntimeManager`. Chromium headless de este entorno no terminó `--dump-dom` dentro de 30 s y emitió errores de DBus/zygote del contenedor. Resultado: `NOT TESTED`. No se convierte ese timeout del entorno en PASS ni en fallo funcional de Raven.

## Limitación principal

Los archivos Swift definen el bridge y contrato del host, pero `UnsupportedAndroidGuestEngine` todavía rechaza el lanzamiento nativo. Para ejecutar Activities Java/Kotlin/NDK reales falta la Fase 3+: Activity/Context/Bundle/View, class/runtime object model, Binder/services, Bionic/JNI/ELF y Surface/Metal.
