import Foundation

public actor RavenAndroidPackageStore {
    public struct Transfer: Sendable {
        public let id: String
        public let expectedSize: Int
        public let fileURL: URL
        public var received: Int
    }

    private let root: URL
    private var transfers: [String: Transfer] = [:]
    private var installs: [String: URL] = [:]

    public init(root: URL? = nil) throws {
        if let root { self.root = root }
        else {
            let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory
            self.root = base.appendingPathComponent("RavenAndroid", isDirectory: true)
        }
        try FileManager.default.createDirectory(at: self.root, withIntermediateDirectories: true)
    }

    public func begin(size: Int) throws -> String {
        guard size > 0 else { throw RavenAndroidGuestError.invalidTransfer }
        let id = UUID().uuidString
        let url = root.appendingPathComponent("incoming-\(id).apk")
        FileManager.default.createFile(atPath: url.path, contents: Data())
        transfers[id] = Transfer(id: id, expectedSize: size, fileURL: url, received: 0)
        return id
    }

    public func append(transferId: String, base64: String) throws -> Int {
        guard var transfer = transfers[transferId], let data = Data(base64Encoded: base64) else { throw RavenAndroidGuestError.invalidTransfer }
        let handle = try FileHandle(forWritingTo: transfer.fileURL)
        try handle.seekToEnd()
        try handle.write(contentsOf: data)
        try handle.close()
        transfer.received += data.count
        guard transfer.received <= transfer.expectedSize else { throw RavenAndroidGuestError.invalidTransfer }
        transfers[transferId] = transfer
        return transfer.received
    }

    public func finish(transferId: String) throws -> String {
        guard let transfer = transfers.removeValue(forKey: transferId), transfer.received == transfer.expectedSize else { throw RavenAndroidGuestError.invalidTransfer }
        let installId = UUID().uuidString
        let url = root.appendingPathComponent("install-\(installId).apk")
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
        try FileManager.default.moveItem(at: transfer.fileURL, to: url)
        installs[installId] = url
        return installId
    }

    public func url(for installId: String) throws -> URL {
        guard let url = installs[installId], FileManager.default.fileExists(atPath: url.path) else { throw RavenAndroidGuestError.packageMissing }
        return url
    }
}
