import Capacitor
import Foundation
import SQLite3
import UIKit
import UniformTypeIdentifiers

/**
 * MBTilesPlugin — iOS Swift port of MBTilesPlugin.java
 *
 * Provides native MBTiles file handling for GeoCrop on iOS:
 *   - pickAndImport : UIDocumentPickerViewController → stream copy to app Documents/mbtiles/
 *   - list          : enumerate saved .json metadata files
 *   - getTile       : SQLite tile query, returns base64 tile data
 *   - importFromUrl : streaming HTTP download → disk (zero memory overhead)
 *   - deleteFile    : remove .mbtiles + .json files
 *
 * All plugin methods mirror the Java implementation exactly so the same JS code
 * (mbtiles.js) works on both Android and iOS without modification.
 */
@objc(MBTilesPlugin)
public class MBTilesPlugin: CAPPlugin, UIDocumentPickerDelegate {

    private var openDatabases: [String: OpaquePointer] = [:]
    private var pendingPickCall: CAPPluginCall?
    private var pendingPickName: String = "Untitled"

    // Overlay pick — separate pending call so MBTiles and overlay pickers don't collide
    private var pendingOverlayPickCall: CAPPluginCall?
    private var pendingOverlayPickName: String = "Overlay"

    // App Documents/mbtiles/ — created on first access
    private var mbtilesDir: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = docs.appendingPathComponent("mbtiles", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    // App Documents/overlays/ — created on first access
    private var overlaysDir: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = docs.appendingPathComponent("overlays", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    // MARK: — pickAndImport

    @objc func pickAndImport(_ call: CAPPluginCall) {
        call.keepAlive = true   // we resolve after async document picker callback
        pendingPickCall = call
        pendingPickName = call.getString("name") ?? "Untitled"

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let picker: UIDocumentPickerViewController
            if #available(iOS 14.0, *) {
                picker = UIDocumentPickerViewController(forOpeningContentTypes: [.data])
            } else {
                picker = UIDocumentPickerViewController(documentTypes: ["public.data"], in: .open)
            }
            picker.delegate = self
            picker.allowsMultipleSelection = false
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let sourceUrl = urls.first else { return }
        // Dispatch to whichever pick is pending
        if let call = pendingOverlayPickCall {
            pendingOverlayPickCall = nil
            handleOverlayPick(call: call, sourceUrl: sourceUrl, name: pendingOverlayPickName)
            return
        }
        guard let call = pendingPickCall else { return }
        pendingPickCall = nil
        let name = pendingPickName

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }

            let accessed = sourceUrl.startAccessingSecurityScopedResource()
            defer { if accessed { sourceUrl.stopAccessingSecurityScopedResource() } }

            let id = "mbt_\(Int(Date().timeIntervalSince1970 * 1000))"
            let destFile = self.mbtilesDir.appendingPathComponent("\(id).mbtiles")

            guard let inputStream = InputStream(url: sourceUrl) else {
                call.reject("Cannot open file")
                return
            }
            guard let outputStream = OutputStream(url: destFile, append: false) else {
                call.reject("Cannot create destination file")
                return
            }

            inputStream.open()
            outputStream.open()
            let bufSize = 65536
            let buf = UnsafeMutablePointer<UInt8>.allocate(capacity: bufSize)
            defer { buf.deallocate() }
            var totalBytes: Int64 = 0

            while inputStream.hasBytesAvailable {
                let n = inputStream.read(buf, maxLength: bufSize)
                if n <= 0 { break }
                _ = outputStream.write(buf, maxLength: n)
                totalBytes += Int64(n)
            }
            inputStream.close()
            outputStream.close()

            if totalBytes < 100 {
                try? FileManager.default.removeItem(at: destFile)
                call.reject("File too small to be a valid MBTiles")
                return
            }

            let meta = self.readMetadata(path: destFile.path)
            let info: JSObject = [
                "id":        id,
                "name":      name,
                "fileSize":  totalBytes,
                "fileSizeMB": String(format: "%.1f", Double(totalBytes) / (1024 * 1024)),
                "minZoom":   meta["minZoom"] as? Int ?? 0,
                "maxZoom":   meta["maxZoom"] as? Int ?? 18,
                "bounds":    meta["bounds"]  as? String ?? "",
                "center":    meta["center"]  as? String ?? ""
            ]

            do {
                let jsonData = try JSONSerialization.data(withJSONObject: info)
                let metaFile = self.mbtilesDir.appendingPathComponent("\(id).json")
                try jsonData.write(to: metaFile)
                call.resolve(info)
            } catch {
                call.reject("Metadata save failed: \(error.localizedDescription)")
            }
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        if pendingOverlayPickCall != nil {
            pendingOverlayPickCall?.reject("cancelled")
            pendingOverlayPickCall = nil
        } else {
            pendingPickCall?.reject("File selection cancelled")
            pendingPickCall = nil
        }
    }

    // MARK: — pickAndImportOverlay

    @objc func pickAndImportOverlay(_ call: CAPPluginCall) {
        call.keepAlive = true
        pendingOverlayPickCall = call
        pendingOverlayPickName = call.getString("name") ?? "Overlay"

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let picker: UIDocumentPickerViewController
            if #available(iOS 14.0, *) {
                picker = UIDocumentPickerViewController(forOpeningContentTypes: [.data])
            } else {
                picker = UIDocumentPickerViewController(documentTypes: ["public.data"], in: .open)
            }
            picker.delegate = self
            picker.allowsMultipleSelection = false
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    private func handleOverlayPick(call: CAPPluginCall, sourceUrl: URL, name: String) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }

            let accessed = sourceUrl.startAccessingSecurityScopedResource()
            defer { if accessed { sourceUrl.stopAccessingSecurityScopedResource() } }

            let ext = sourceUrl.pathExtension.lowercased().isEmpty ? "geojson"
                      : sourceUrl.pathExtension.lowercased()
            let id = "ov_\(Int(Date().timeIntervalSince1970 * 1000))"
            let destFile = self.overlaysDir.appendingPathComponent("\(id).\(ext)")

            guard let inputStream = InputStream(url: sourceUrl) else {
                call.reject("Cannot open file"); return
            }
            guard let outputStream = OutputStream(url: destFile, append: false) else {
                call.reject("Cannot create destination file"); return
            }

            inputStream.open()
            outputStream.open()
            let bufSize = 65536
            let buf = UnsafeMutablePointer<UInt8>.allocate(capacity: bufSize)
            defer { buf.deallocate() }
            var totalBytes: Int64 = 0

            while inputStream.hasBytesAvailable {
                let n = inputStream.read(buf, maxLength: bufSize)
                if n <= 0 { break }
                _ = outputStream.write(buf, maxLength: n)
                totalBytes += Int64(n)
            }
            inputStream.close()
            outputStream.close()

            let info: JSObject = [
                "id":        id,
                "name":      name,
                "ext":       ext,
                "fileSize":  totalBytes,
                "fileSizeMB": String(format: "%.1f", Double(totalBytes) / (1024 * 1024)),
                "filePath":  destFile.path
            ]
            call.resolve(info)
        }
    }

    // MARK: — deleteOverlayFile

    @objc func deleteOverlayFile(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("No id"); return }
        let dir = overlaysDir
        if let files = try? FileManager.default.contentsOfDirectory(at: dir,
                includingPropertiesForKeys: nil) {
            for f in files where f.lastPathComponent.hasPrefix(id) {
                try? FileManager.default.removeItem(at: f)
            }
        }
        call.resolve([:])
    }

    // MARK: — list

    @objc func list(_ call: CAPPluginCall) {
        do {
            let files = try FileManager.default.contentsOfDirectory(
                at: mbtilesDir, includingPropertiesForKeys: nil)
            var items: [JSObject] = []
            for file in files where file.pathExtension == "json" {
                let data = try Data(contentsOf: file)
                if let obj = try JSONSerialization.jsonObject(with: data) as? JSObject {
                    items.append(obj)
                }
            }
            call.resolve(["items": items])
        } catch {
            call.resolve(["items": [] as [Any]])
        }
    }

    // MARK: — getTile

    @objc func getTile(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("No id provided")
            return
        }
        let z = call.getInt("z") ?? 0
        let x = call.getInt("x") ?? 0
        let y = call.getInt("y") ?? 0
        // TMS Y flip: Leaflet XYZ → MBTiles TMS
        let tmsY = (1 << z) - 1 - y

        guard let db = getDb(id: id) else {
            call.resolve(["data": NSNull()])
            return
        }

        let sql = "SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            call.resolve(["data": NSNull()])
            return
        }
        defer { sqlite3_finalize(stmt) }

        sqlite3_bind_int(stmt, 1, Int32(z))
        sqlite3_bind_int(stmt, 2, Int32(x))
        sqlite3_bind_int(stmt, 3, Int32(tmsY))

        if sqlite3_step(stmt) == SQLITE_ROW {
            let byteCount = Int(sqlite3_column_bytes(stmt, 0))
            if byteCount > 0, let ptr = sqlite3_column_blob(stmt, 0) {
                let tileData = Data(bytes: ptr, count: byteCount)
                let b64 = tileData.base64EncodedString()
                // Detect PNG by magic bytes 0x89 0x50 0x4E 0x47
                let isPng = byteCount >= 4
                    && tileData[0] == 0x89 && tileData[1] == 0x50
                    && tileData[2] == 0x4E && tileData[3] == 0x47
                let contentType = isPng ? "image/png" : "image/jpeg"
                call.resolve(["data": b64, "contentType": contentType])
                return
            }
        }
        call.resolve(["data": NSNull()])
    }

    // MARK: — importFromUrl

    @objc func importFromUrl(_ call: CAPPluginCall) {
        guard let urlStr = call.getString("url"), let url = URL(string: urlStr) else {
            call.reject("No URL provided")
            return
        }
        let token = call.getString("token") ?? ""
        let name  = call.getString("name")  ?? "Untitled"

        let id       = "mbt_\(Int(Date().timeIntervalSince1970 * 1000))"
        let destFile = mbtilesDir.appendingPathComponent("\(id).mbtiles")

        var request = URLRequest(url: url, timeoutInterval: 600)
        request.timeoutInterval = 600
        if !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let downloader = MBTilesDownloader(
            request:    request,
            destFile:   destFile,
            onProgress: { [weak self] received, total in
                self?.notifyListeners("mbtDownloadProgress",
                                      data: ["received": received, "total": total])
            },
            onComplete: { [weak self] totalBytes, error in
                guard let self = self else { return }
                if let error = error {
                    try? FileManager.default.removeItem(at: destFile)
                    call.reject("Download failed: \(error.localizedDescription)")
                    return
                }
                if totalBytes < 100 {
                    try? FileManager.default.removeItem(at: destFile)
                    call.reject("Downloaded file too small")
                    return
                }
                let meta = self.readMetadata(path: destFile.path)
                let info: JSObject = [
                    "id":        id,
                    "name":      name,
                    "fileSize":  totalBytes,
                    "fileSizeMB": String(format: "%.1f", Double(totalBytes) / (1024 * 1024)),
                    "minZoom":   meta["minZoom"] as? Int ?? 0,
                    "maxZoom":   meta["maxZoom"] as? Int ?? 18,
                    "bounds":    meta["bounds"]  as? String ?? "",
                    "center":    meta["center"]  as? String ?? ""
                ]
                do {
                    let jsonData = try JSONSerialization.data(withJSONObject: info)
                    let metaFile = self.mbtilesDir.appendingPathComponent("\(id).json")
                    try jsonData.write(to: metaFile)
                    call.resolve(info)
                } catch {
                    call.reject("Metadata save failed: \(error.localizedDescription)")
                }
            }
        )
        downloader.start()
    }

    // MARK: — deleteFile

    @objc func deleteFile(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("No id provided")
            return
        }
        if let db = openDatabases[id] {
            sqlite3_close(db)
            openDatabases.removeValue(forKey: id)
        }
        try? FileManager.default.removeItem(at: mbtilesDir.appendingPathComponent("\(id).mbtiles"))
        try? FileManager.default.removeItem(at: mbtilesDir.appendingPathComponent("\(id).json"))
        call.resolve([:])
    }

    // MARK: — Helpers

    private func getDb(id: String) -> OpaquePointer? {
        if let db = openDatabases[id] { return db }
        let path = mbtilesDir.appendingPathComponent("\(id).mbtiles").path
        guard FileManager.default.fileExists(atPath: path) else { return nil }
        var db: OpaquePointer?
        guard sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX, nil) == SQLITE_OK else {
            return nil
        }
        openDatabases[id] = db
        return db
    }

    private func readMetadata(path: String) -> [String: Any] {
        var meta: [String: Any] = [:]
        var db: OpaquePointer?
        guard sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else { return meta }
        defer { sqlite3_close(db) }

        var stmt: OpaquePointer?
        let sql = "SELECT name, value FROM metadata"
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return meta }
        defer { sqlite3_finalize(stmt) }

        while sqlite3_step(stmt) == SQLITE_ROW {
            guard let kPtr = sqlite3_column_text(stmt, 0),
                  let vPtr = sqlite3_column_text(stmt, 1) else { continue }
            let key = String(cString: kPtr)
            let val = String(cString: vPtr)
            switch key {
            case "minzoom": meta["minZoom"] = Int(val) ?? 0
            case "maxzoom": meta["maxZoom"] = Int(val) ?? 18
            case "bounds":  meta["bounds"]  = val
            case "center":  meta["center"]  = val
            default: break
            }
        }
        return meta
    }
}

// MARK: — MBTilesDownloader

/**
 * Streams an HTTP response directly to disk using URLSessionDataDelegate.
 * Fires onProgress every 512 KB — mirrors the Java Thread + notifyListeners pattern.
 * Zero memory overhead regardless of file size.
 */
private class MBTilesDownloader: NSObject, URLSessionDataDelegate {

    private let destFile:   URL
    private let onProgress: (Int64, Int64) -> Void
    private let onComplete: (Int64, Error?) -> Void

    private var outputStream:   OutputStream?
    private var session:        URLSession?
    private var totalBytes:     Int64 = 0
    private var contentLength:  Int64 = -1
    private var lastReport:     Int64 = 0

    init(request:    URLRequest,
         destFile:   URL,
         onProgress: @escaping (Int64, Int64) -> Void,
         onComplete: @escaping (Int64, Error?) -> Void) {
        self.destFile   = destFile
        self.onProgress = onProgress
        self.onComplete = onComplete
        super.init()

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForResource = 600
        config.timeoutIntervalForRequest  = 600
        // Retain self as delegate — session retains delegate strongly until invalidated
        session = URLSession(configuration: config, delegate: self, delegateQueue: nil)

        outputStream = OutputStream(url: destFile, append: false)
        outputStream?.open()
        session?.dataTask(with: request).resume()
    }

    func start() { /* initialisation happens in init */ }

    // Headers received — capture Content-Length
    func urlSession(_ session: URLSession,
                    dataTask: URLSessionDataTask,
                    didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        contentLength = response.expectedContentLength   // -1 if unknown
        completionHandler(.allow)
    }

    // Data chunk received — write to disk, fire progress every 512 KB
    func urlSession(_ session: URLSession,
                    dataTask: URLSessionDataTask,
                    didReceive data: Data) {
        data.withUnsafeBytes { rawBuf in
            if let ptr = rawBuf.bindMemory(to: UInt8.self).baseAddress {
                _ = outputStream?.write(ptr, maxLength: data.count)
            }
        }
        totalBytes += Int64(data.count)
        if totalBytes - lastReport >= 512 * 1024 {
            lastReport = totalBytes
            onProgress(totalBytes, contentLength)
        }
    }

    // Transfer complete (error == nil on success)
    func urlSession(_ session: URLSession,
                    task: URLSessionTask,
                    didCompleteWithError error: Error?) {
        outputStream?.close()
        // Final 100% progress event
        onProgress(totalBytes, totalBytes)
        onComplete(totalBytes, error)
        session.invalidateAndCancel()
    }
}
