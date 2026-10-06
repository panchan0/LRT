# Raven Android Host iOS · Phase 2

Esta carpeta es el lado iOS del protocolo que usa el AndroidRuntime integrado en Raven 0.18.0.

Ya implementa de forma concreta:

- recepción de mensajes desde WKWebView;
- negociación `host-capabilities`;
- transferencia APK por chunks;
- almacenamiento sandbox de paquetes;
- lifecycle de sesión (`launch`, `pause`, `resume`, `stop`, `reset`, `dispose`);
- errores explícitos cuando no existe un `RavenAndroidGuestEngine` real.

`UnsupportedAndroidGuestEngine` es intencional: jamás devuelve un READY falso. La siguiente capa nativa debe implementar `RavenAndroidGuestEngine` con Android Framework/DEX/NDK reales o un motor guest equivalente.

El JavaScript usa el canal `raven-android-runtime/v1`. El host v2 añade `host-capabilities` sin romper el envelope v1.
