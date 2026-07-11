import XCTest
@testable import FilmowoCore

final class PosterStoreTests: XCTestCase {
    private var directory: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PosterStoreTests-\(UUID().uuidString)", isDirectory: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    private func url(_ s: String) -> URL { URL(string: s)! }
    private func fileExists(_ url: URL) -> Bool {
        FileManager.default.fileExists(
            atPath: directory.appendingPathComponent(PosterStore.fileName(for: url)).path
        )
    }

    // MARK: - Keying

    func testCacheKeyIsStableAndURLSpecific() {
        let a = PosterStore.fileName(for: url("https://img/x.jpg"))
        let again = PosterStore.fileName(for: url("https://img/x.jpg"))
        let other = PosterStore.fileName(for: url("https://img/y.jpg"))
        XCTAssertEqual(a, again, "same URL must hash to the same on-disk key across calls")
        XCTAssertNotEqual(a, other, "different URLs must not collide")
        XCTAssertTrue(a.hasSuffix(".img"))
    }

    // MARK: - Disk-first caching

    func testDownloadsOnceThenServesFromDisk() async {
        let counter = CallCounter()
        let store = PosterStore(directory: directory, fetch: { _ in
            await counter.bump()
            return Data("poster-bytes".utf8)
        })
        let first = await store.data(for: url("https://img/a.jpg"))
        let second = await store.data(for: url("https://img/a.jpg"))
        XCTAssertEqual(first, Data("poster-bytes".utf8))
        XCTAssertEqual(second, first)
        let calls = await counter.value
        XCTAssertEqual(calls, 1, "the second load must come off disk, not the network")
    }

    func testFailedDownloadIsNotCached() async {
        let counter = CallCounter()
        let store = PosterStore(directory: directory, fetch: { _ in
            await counter.bump()
            return nil // simulate a non-2xx / transport failure
        })
        let first = await store.data(for: url("https://img/b.jpg"))
        let second = await store.data(for: url("https://img/b.jpg"))
        XCTAssertNil(first)
        XCTAssertNil(second)
        let calls = await counter.value
        XCTAssertEqual(calls, 2, "a failure must not be persisted as a blank — the URL is retried")
    }

    // MARK: - LRU eviction

    func testEvictsLeastRecentlyUsedWhenOverCap() async {
        // A 250-byte cap holds two 100-byte posters; a third write trims down to
        // the 85% low-water mark (212 bytes), evicting the single oldest file.
        let clock = Clock(1000)
        let store = PosterStore(
            directory: directory,
            maxBytes: 250,
            fetch: { _ in Data(count: 100) },
            now: { clock.date }
        )
        let a = url("https://img/a.jpg")
        let b = url("https://img/b.jpg")
        let c = url("https://img/c.jpg")

        clock.seconds = 1000; _ = await store.data(for: a) // written, stamped t=1000
        clock.seconds = 1001; _ = await store.data(for: b) // written, stamped t=1001
        clock.seconds = 1002; _ = await store.data(for: a) // disk hit → A re-stamped t=1002
        clock.seconds = 1003; _ = await store.data(for: c) // write pushes over cap → trim

        XCTAssertTrue(fileExists(a), "A was used most recently, so it survives")
        XCTAssertTrue(fileExists(c), "C was just written, so it survives")
        XCTAssertFalse(fileExists(b), "B is the least-recently-used and is evicted")
    }
}

/// Async-safe call tally for the injected fetch stub.
private actor CallCounter {
    private(set) var value = 0
    func bump() { value += 1 }
}

/// A hand-advanced clock so the LRU ordering is deterministic instead of racing
/// the filesystem's 1-second timestamp resolution.
private final class Clock: @unchecked Sendable {
    var seconds: TimeInterval
    init(_ seconds: TimeInterval) { self.seconds = seconds }
    var date: Date { Date(timeIntervalSince1970: seconds) }
}
