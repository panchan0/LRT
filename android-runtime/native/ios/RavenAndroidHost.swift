import Foundation
#if canImport(WebKit)
import WebKit

@MainActor
public final class RavenAndroidHost: NSObject, WKScriptMessageHandler {
    public static let handlerName = "ravenAndroidRuntime"
    private let store: RavenAndroidPackageStore
    private let engine: any RavenAndroidGuestEngine
    private weak var webView: WKWebView?

    public init(webView: WKWebView, store: RavenAndroidPackageStore, engine: any RavenAndroidGuestEngine) {
        self.webView = webView
        self.store = store
        self.engine = engine
        super.init()
        webView.configuration.userContentController.add(self, name: Self.handlerName)
    }

    deinit { webView?.configuration.userContentController.removeScriptMessageHandler(forName: Self.handlerName) }

    public func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == Self.handlerName, let body = message.body as? [String: Any], let id = body["id"] as? String, let command = body["command"] as? String else { return }
        guard (body["channel"] as? String) == "raven-android-runtime/v1" else { resolve(id: id, payload: nil, error: "ANDROID_CHANNEL_INVALID"); return }
        let payload = body["payload"] as? [String: Any] ?? [:]
        Task { await handle(id: id, command: command, payload: payload) }
    }

    private func handle(id: String, command: String, payload: [String: Any]) async {
        do {
            switch command {
            case "host-capabilities":
                let caps = RavenAndroidHostCapabilities(protocolVersion: 2, platform: "iOS", guestEngineAvailable: engine.isAvailable, features: ["apk-transfer", "lifecycle", "diagnostics"], supportedAbis: ["arm64-v8a"])
                resolve(id: id, payload: try jsonObject(caps), error: nil)
            case "apk-transfer-begin":
                guard let size = (payload["size"] as? NSNumber)?.intValue else { throw RavenAndroidGuestError.invalidTransfer }
                let transferId = try await store.begin(size: size)
                resolve(id: id, payload: ["transferId": transferId], error: nil)
            case "apk-transfer-chunk":
                guard let transferId = payload["transferId"] as? String, let data = payload["data"] as? String else { throw RavenAndroidGuestError.invalidTransfer }
                let received = try await store.append(transferId: transferId, base64: data)
                resolve(id: id, payload: ["received": received], error: nil)
            case "apk-transfer-end":
                guard let transferId = payload["transferId"] as? String else { throw RavenAndroidGuestError.invalidTransfer }
                let installId = try await store.finish(transferId: transferId)
                resolve(id: id, payload: ["installId": installId], error: nil)
            case "launch":
                guard engine.isAvailable else { throw RavenAndroidGuestError.backendUnavailable }
                guard let installId = payload["installId"] as? String else { throw RavenAndroidGuestError.packageMissing }
                let url = try await store.url(for: installId)
                let request = RavenAndroidLaunchRequest(installId: installId, packageName: payload["packageName"] as? String, appId: payload["appId"] as? String)
                let result = try await engine.launch(request, apkURL: url)
                resolve(id: id, payload: try jsonObject(result), error: nil)
            case "pause", "resume", "stop", "reset", "dispose":
                guard engine.isAvailable else { throw RavenAndroidGuestError.backendUnavailable }
                guard let sessionId = payload["sessionId"] as? String else { throw RavenAndroidGuestError.invalidMessage("sessionId faltante") }
                switch command {
                case "pause": try await engine.pause(sessionId: sessionId)
                case "resume": try await engine.resume(sessionId: sessionId)
                case "stop": try await engine.stop(sessionId: sessionId)
                case "reset": try await engine.reset(sessionId: sessionId)
                default: try await engine.dispose(sessionId: sessionId)
                }
                resolve(id: id, payload: ["ok": true], error: nil)
            default: throw RavenAndroidGuestError.invalidMessage("Comando no soportado: \(command)")
            }
        } catch {
            resolve(id: id, payload: nil, error: (error as? LocalizedError)?.errorDescription ?? String(describing: error))
        }
    }

    private func jsonObject<T: Encodable>(_ value: T) throws -> Any {
        let data = try JSONEncoder().encode(value)
        return try JSONSerialization.jsonObject(with: data)
    }

    private func resolve(id: String, payload: Any?, error: String?) {
        guard let webView else { return }
        let object: [String: Any?] = ["id": id, "payload": payload, "error": error]
        guard let data = try? JSONSerialization.data(withJSONObject: object.compactMapValues { $0 }), let json = String(data: data, encoding: .utf8) else { return }
        let js = "(()=>{const r=\(json);window.__RAVEN_ANDROID_NATIVE_RESOLVE__?.(r.id,r.payload,r.error||null)})()"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }
}
#endif
