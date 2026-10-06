import Foundation

public struct RavenAndroidHostCapabilities: Codable, Sendable {
    public let protocolVersion: Int
    public let platform: String
    public let guestEngineAvailable: Bool
    public let features: [String]
    public let supportedAbis: [String]
}

public struct RavenAndroidLaunchRequest: Sendable {
    public let installId: String
    public let packageName: String?
    public let appId: String?
}

public struct RavenAndroidLaunchResult: Codable, Sendable {
    public let sessionId: String
    public let message: String
}

public protocol RavenAndroidGuestEngine: Sendable {
    var isAvailable: Bool { get }
    func launch(_ request: RavenAndroidLaunchRequest, apkURL: URL) async throws -> RavenAndroidLaunchResult
    func pause(sessionId: String) async throws
    func resume(sessionId: String) async throws
    func stop(sessionId: String) async throws
    func reset(sessionId: String) async throws
    func dispose(sessionId: String) async throws
}

public enum RavenAndroidGuestError: Error, LocalizedError, Sendable {
    case backendUnavailable
    case invalidTransfer
    case packageMissing
    case invalidMessage(String)

    public var errorDescription: String? {
        switch self {
        case .backendUnavailable: return "ANDROID_BACKEND_UNAVAILABLE: AndroidGuestEngine no está enlazado en esta build."
        case .invalidTransfer: return "ANDROID_TRANSFER_INVALID: transferencia APK inválida."
        case .packageMissing: return "ANDROID_PACKAGE_MISSING: el APK instalado no existe."
        case .invalidMessage(let value): return "ANDROID_MESSAGE_INVALID: \(value)"
        }
    }
}

public struct UnsupportedAndroidGuestEngine: RavenAndroidGuestEngine {
    public init() {}
    public var isAvailable: Bool { false }
    public func launch(_ request: RavenAndroidLaunchRequest, apkURL: URL) async throws -> RavenAndroidLaunchResult { throw RavenAndroidGuestError.backendUnavailable }
    public func pause(sessionId: String) async throws { throw RavenAndroidGuestError.backendUnavailable }
    public func resume(sessionId: String) async throws { throw RavenAndroidGuestError.backendUnavailable }
    public func stop(sessionId: String) async throws { throw RavenAndroidGuestError.backendUnavailable }
    public func reset(sessionId: String) async throws { throw RavenAndroidGuestError.backendUnavailable }
    public func dispose(sessionId: String) async throws { throw RavenAndroidGuestError.backendUnavailable }
}
