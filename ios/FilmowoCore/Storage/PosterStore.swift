import Foundation
#if canImport(FoundationNetworking)
// On Linux (swift-corelibs-foundation, used by `swift test` in CI)
// URLSession/URLRequest live in this separate module, not Foundation.
import FoundationNetworking
#endif

/// Disk-backed cache for poster (and provider-logo) images so each downloads at
/// most once and survives across launches — the iOS counterpart of Android's
/// Coil disk cache. SwiftUI's `AsyncImage` leans on `URLCache`, which is
/// memory-biased and small, so posters were re-fetched far more than they
/// should be; this stores the bytes as one file per URL under `Caches/Posters`
/// and serves them straight off disk on the next load.
///
/// Bounded by a simple LRU size cap (`maxBytes`): every read bumps the file's
/// timestamp, and once a write pushes the directory past the cap the
/// least-recently-used files are deleted down to a low-water mark. Recommend is
/// a recommendation *feed* — there's no fixed "repertoire" to reconcile a
/// keep-set against the way the movies app has, and its cards live in separate
/// Discover/Watchlist stores that don't all load at launch. An LRU cap (like
/// Coil's on Android) bounds growth without a keep-set that would evict the
/// watchlist's posters on launches where that tab hasn't loaded yet.
///
/// Foundation-only — it deals in raw `Data`, never `UIImage` — so it lives in
/// `FilmowoCore` and is unit-tested without a simulator. The SwiftUI glue that
/// decodes the bytes into an `Image` lives in `CachedAsyncImage`.
public actor PosterStore {
    /// Production singleton — caches under the app's Caches directory and
    /// downloads through a cache-bypassing `URLSession`.
    public static let shared = PosterStore()

    private let directory: URL
    private let fetch: @Sendable (URL) async -> Data?
    private let maxBytes: Int
    private let now: @Sendable () -> Date

    /// - Parameters:
    ///   - directory: where cached image files live. Defaults to
    ///     `Caches/Posters`. Tests pass a throwaway temp directory.
    ///   - maxBytes: LRU cap for the whole directory (150 MB by default —
    ///     roughly a couple of thousand w500 posters). Tests pass a tiny cap
    ///     to exercise eviction.
    ///   - fetch: downloads the bytes for a URL, or returns `nil` on any
    ///     non-2xx / transport error. Defaults to a cache-bypassing
    ///     `URLSession` (this disk store *is* the cache); tests inject a stub
    ///     so the cache logic is exercised without the network.
    ///   - now: the clock stamped onto a file when it's written or read, and
    ///     the key eviction sorts by. Injected so tests get a deterministic
    ///     LRU ordering instead of racing the filesystem's 1-second clock.
    public init(
        directory: URL = PosterStore.defaultDirectory,
        maxBytes: Int = 150 * 1024 * 1024,
        fetch: @escaping @Sendable (URL) async -> Data? = { await PosterStore.networkFetch($0) },
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.directory = directory
        self.maxBytes = maxBytes
        self.fetch = fetch
        self.now = now
        try? FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true
        )
    }

    /// Bytes for `url`, disk-first. On a hit we bump the file's timestamp (so it
    /// counts as recently used) and return it. On a miss we download via
    /// `fetch`, persist the bytes, evict down to the cap if the write pushed us
    /// over, and return them. A failed download returns `nil` and writes
    /// nothing — a transient 4xx must not be cached as a permanent blank; the
    /// caller falls back to a placeholder and we retry the URL next time.
    public func data(for url: URL) async -> Data? {
        let file = fileURL(for: url)
        if let cached = try? Data(contentsOf: file) {
            touch(file)
            return cached
        }
        guard let downloaded = await fetch(url) else { return nil }
        try? downloaded.write(to: file, options: .atomic)
        touch(file)
        trimToCap()
        return downloaded
    }

    // MARK: - LRU eviction

    /// Delete least-recently-used files until the directory is back under the
    /// cap. Runs after a write; a no-op until the cache grows past `maxBytes`,
    /// then drops to a low-water mark (85%) so we don't re-trim on every
    /// subsequent write once we're near the cap.
    private func trimToCap() {
        let fm = FileManager.default
        let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey]
        guard let entries = try? fm.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: keys
        ) else { return }
        let files = entries.compactMap { url -> (url: URL, size: Int, date: Date)? in
            guard let v = try? url.resourceValues(forKeys: Set(keys)),
                  let size = v.fileSize, let date = v.contentModificationDate else { return nil }
            return (url, size, date)
        }
        var total = files.reduce(0) { $0 + $1.size }
        guard total > maxBytes else { return }
        let target = maxBytes * 85 / 100
        for file in files.sorted(by: { $0.date < $1.date }) { // least-recently-used first
            if total <= target { break }
            try? fm.removeItem(at: file.url)
            total -= file.size
        }
    }

    /// Mark `file` as just-used by setting its modification date to `now()` —
    /// the key `trimToCap` evicts by.
    private func touch(_ file: URL) {
        try? FileManager.default.setAttributes(
            [.modificationDate: now()], ofItemAtPath: file.path
        )
    }

    // MARK: - Keying

    private func fileURL(for url: URL) -> URL {
        directory.appendingPathComponent(Self.fileName(for: url))
    }

    /// Stable, process-independent filename for an image URL. Swift's `Hasher`
    /// is seeded per launch so it can't key an on-disk cache — the old cache
    /// keyed on `hashValue` never hit after a relaunch; FNV-1a 64-bit is
    /// deterministic across runs.
    public static func fileName(for url: URL) -> String {
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in url.absoluteString.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x0000_0100_0000_01b3
        }
        return String(hash, radix: 16) + ".img"
    }

    // MARK: - Production defaults

    public static var defaultDirectory: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Posters", isDirectory: true)
    }

    private static let session: URLSession = {
        let config = URLSessionConfiguration.default
        // This disk store is the cache; don't double-cache through URLCache.
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: config)
    }()

    public static func networkFetch(_ url: URL) async -> Data? {
        var request = URLRequest(url: url)
        request.setValue("FilmowoIOS/1.0", forHTTPHeaderField: "User-Agent")
        // Completion-handler `dataTask` bridged through a continuation rather
        // than the async `data(for:)` — the latter isn't available on the Linux
        // swift-corelibs-foundation toolchain CI compiles FilmowoCore against.
        // `dataTask` exists on both.
        return await withCheckedContinuation { continuation in
            let task = session.dataTask(with: request) { data, response, _ in
                guard let data,
                      let http = response as? HTTPURLResponse,
                      (200..<300).contains(http.statusCode),
                      !data.isEmpty else {
                    continuation.resume(returning: nil)
                    return
                }
                continuation.resume(returning: data)
            }
            task.resume()
        }
    }
}
