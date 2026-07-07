import XCTest
@testable import Filmowo
import FilmowoCore

/// Verifies `DiscoverStore`'s adaptive rate-queue → picks logic against the
/// `URLProtocol` stub, including the crossover at `RATE_GOAL` and optimistic
/// removal on rate/dismiss.
@MainActor
final class DiscoverStoreTests: XCTestCase {
    private func makeClient() -> FilmowoClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        return FilmowoClient(baseURL: URL(string: "https://test.local")!, session: URLSession(configuration: config))
    }

    override func tearDown() { StubURLProtocol.handler = nil; super.tearDown() }

    private static func queueJSON(count: Int) -> String {
        let items = (0..<count).map { #"{"tmdb_id":\#(1000 + $0),"title":"Film \#($0)","year":2000}"# }
        return #"{"items":[\#(items.joined(separator: ","))],"totalPages":1}"#
    }

    func testOnboardsWhenBelowGoalThenCrossesToPicks() async {
        var rated = 0
        StubURLProtocol.handler = { req in
            switch (req.url!.path, req.httpMethod ?? "GET") {
            case ("/api/ratings", "POST"): rated += 1; return .ok("{}")
            case ("/api/ratings", _): return .ok(#"{"ratings":[]}"#)
            case ("/api/recommend", _):
                return rated >= 10
                    ? .ok(#"{"profileSize":10,"results":[{"tmdb_id":603,"media_type":"movie","title":"The Matrix"}]}"#)
                    : .ok(#"{"profileSize":\#(rated),"results":[]}"#)
            case ("/api/rate-queue", _): return .ok(Self.queueJSON(count: 12))
            case ("/api/watchlist", _): return .ok(#"{"watchlist":[],"genres":[]}"#)
            default: return .ok(#"{"genres":[],"tones":[]}"#)
            }
        }
        let store = DiscoverStore(client: makeClient())
        await store.loadInitial()
        XCTAssertEqual(store.phase, .onboarding)
        XCTAssertEqual(store.leftToRate, 10)
        XCTAssertFalse(store.queue.isEmpty)

        // Rate ten titles; the tenth crosses the goal into picks.
        for _ in 0..<10 {
            guard let item = store.queue.first else { break }
            await store.rateQueueItem(item, value: 8)
        }
        XCTAssertEqual(store.phase, .picks)
        XCTAssertEqual(store.picks.first?.key, "movie:603")
    }

    func testBuildingWhenAtGoalButNoResultsYet() async {
        StubURLProtocol.handler = { req in
            switch req.url!.path {
            case "/api/recommend": return .ok(#"{"profileSize":15,"results":[]}"#)
            case "/api/watchlist": return .ok(#"{"watchlist":[],"genres":[]}"#)
            case "/api/ratings": return .ok(#"{"ratings":[]}"#)
            default: return .ok(#"{"genres":[],"tones":[]}"#)
            }
        }
        let store = DiscoverStore(client: makeClient())
        await store.loadInitial()
        XCTAssertEqual(store.phase, .building)
    }

    func testRatingAndDismissingPicksRemovesThemOptimistically() async {
        StubURLProtocol.handler = { req in
            switch req.url!.path {
            case "/api/recommend":
                return .ok(#"{"profileSize":20,"results":[{"tmdb_id":603,"media_type":"movie","title":"The Matrix"},{"tmdb_id":1399,"media_type":"tv","title":"GoT"}]}"#)
            case "/api/watchlist": return .ok(#"{"watchlist":[],"genres":[]}"#)
            case "/api/ratings": return .ok(#"{"ratings":[]}"#)
            default: return .ok(#"{"genres":[],"tones":[]}"#)
            }
        }
        let store = DiscoverStore(client: makeClient())
        await store.loadInitial()
        XCTAssertEqual(store.phase, .picks)
        XCTAssertEqual(store.picks.count, 2)

        await store.rate(store.picks[0], value: 7)
        XCTAssertEqual(store.picks.map(\.key), ["tv:1399"], "rated pick removed")

        await store.dismiss(store.picks[0])
        XCTAssertTrue(store.picks.isEmpty, "dismissed pick removed")
    }

    func testToggleWatchlistTracksMembership() async {
        StubURLProtocol.handler = { req in
            switch req.url!.path {
            case "/api/recommend":
                return .ok(#"{"profileSize":20,"results":[{"tmdb_id":603,"media_type":"movie","title":"The Matrix"}]}"#)
            case "/api/watchlist": return .ok(#"{"watchlist":[],"genres":[]}"#)
            case "/api/ratings": return .ok(#"{"ratings":[]}"#)
            default: return .ok(#"{"genres":[],"tones":[]}"#)
            }
        }
        let store = DiscoverStore(client: makeClient())
        await store.loadInitial()
        let card = store.picks[0]
        XCTAssertFalse(store.watchlistKeys.contains(card.key))
        await store.toggleWatchlist(card)
        XCTAssertTrue(store.watchlistKeys.contains(card.key))
        await store.toggleWatchlist(card)
        XCTAssertFalse(store.watchlistKeys.contains(card.key))
    }
}
