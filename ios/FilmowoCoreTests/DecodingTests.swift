import XCTest
@testable import FilmowoCore

final class DecodingTests: XCTestCase {
    func testMeDecodesAndIgnoresUnknownKeys() throws {
        let me = try Fixtures.decode(Me.self, "me.json")
        XCTAssertFalse(me.anonymous)
        XCTAssertTrue(me.onboarded)
        XCTAssertEqual(me.user?.name, "Ada")
        XCTAssertEqual(me.services, [8, 337, 119])
        XCTAssertEqual(me.country, "PL")
        XCTAssertEqual(me.language, "pl")
        XCTAssertEqual(me.detectedCountry, "PL")
        // `watchlistSort` is present in the payload but not in the model — must be ignored.
    }

    func testRecommendDecodesFullAndSparseCards() throws {
        let recs = try Fixtures.decode(Recommendations.self, "recommend.json")
        XCTAssertEqual(recs.profileSize, 42)
        XCTAssertEqual(recs.results.count, 2)

        let matrix = recs.results[0]
        XCTAssertEqual(matrix.key, "movie:603")
        XCTAssertEqual(matrix.title, "The Matrix")
        XCTAssertEqual(matrix.year, 1999)
        XCTAssertEqual(matrix.imdbRating, 8.7)
        XCTAssertEqual(matrix.metascore, 73)
        XCTAssertEqual(matrix.tones.map(\.slug), ["mind-bending", "dystopian"])
        XCTAssertEqual(matrix.services.first?.name, "Netflix")
        XCTAssertEqual(matrix.genreIds, [28, 878])
    }

    /// The load-bearing tolerance: a card that omits `services`, `tones`,
    /// `cast`, etc. must decode to empty collections, NOT fail the whole list.
    /// This is the exact "one field mismatch empties a whole list" footgun.
    func testSparseCardDegradesToDefaultsNotFailure() throws {
        let recs = try Fixtures.decode(Recommendations.self, "recommend.json")
        let got = recs.results[1]
        XCTAssertEqual(got.key, "tv:1399")
        XCTAssertEqual(got.mediaType, "tv")
        XCTAssertEqual(got.seasons, 8)
        XCTAssertEqual(got.episodes, 73)
        XCTAssertTrue(got.services.isEmpty)
        XCTAssertTrue(got.tones.isEmpty)
        XCTAssertTrue(got.cast.isEmpty)
        XCTAssertNil(got.imdbRating)
    }

    func testWhereInfoDecodes() throws {
        let w = try Fixtures.decode(WhereInfo.self, "where.json")
        XCTAssertEqual(w.region, "PL")
        XCTAssertEqual(w.flatrate.count, 2)
        XCTAssertEqual(w.deepLinks.first?.providerId, 8)
        XCTAssertNil(w.deepLinks[1].type) // optional type omitted on the second link
        XCTAssertEqual(w.credits["director"], "The Wachowskis")
    }

    func testRateQueueDecodes() throws {
        let q = try Fixtures.decode(RateQueue.self, "rate-queue.json")
        XCTAssertEqual(q.totalPages, 12)
        XCTAssertEqual(q.items.map(\.tmdbId), [238, 155])
        XCTAssertEqual(q.items[0].title, "The Godfather")
        XCTAssertNil(q.items[1].overview) // omitted → nil, not a decode failure
    }

    func testRatingsDecode() throws {
        let r = try Fixtures.decode(RatingsResponse.self, "ratings.json")
        XCTAssertEqual(r.ratings.count, 2)
        XCTAssertEqual(r.ratings[0].key, "movie:603")
        XCTAssertEqual(r.ratings[0].rating, 9.0)
        XCTAssertEqual(r.ratings[0].ratedAt, "2026-06-01T12:00:00Z")
        XCTAssertNil(r.ratings[1].source)
    }

    func testWatchlistDecodesIgnoringByName() throws {
        let wl = try Fixtures.decode(WatchlistResponse.self, "watchlist.json")
        XCTAssertEqual(wl.watchlist.count, 1)
        XCTAssertEqual(wl.watchlist[0].key, "movie:27205")
        XCTAssertEqual(wl.genres.map(\.name), ["Action", "Thriller"])
    }

    func testTonesDecode() throws {
        let t = try Fixtures.decode(TonesResponse.self, "tones.json")
        XCTAssertEqual(t.tones.map(\.slug), ["feel-good", "dark", "mind-bending"])
    }

    func testEnrichNDJSONStreamDecodesSkippingBlankLines() throws {
        let rows = FilmowoJSON.decodeNDJSON(EnrichRow.self, from: try Fixtures.data("enrich.ndjson"))
        XCTAssertEqual(rows.count, 3)
        XCTAssertEqual(rows[0].key, "movie:603")
        XCTAssertEqual(rows[0].imdbRating, 8.7)
        XCTAssertEqual(rows[1].key, "tv:1399")
        XCTAssertNil(rows[2].metascore) // third row omits metascore
    }

    /// A card round-trips back to the `POST /api/watchlist` body with snake_case
    /// keys, so re-saving a decoded card hits the same contract the server sent.
    func testCardEncodesSnakeCase() throws {
        let recs = try Fixtures.decode(Recommendations.self, "recommend.json")
        let data = try FilmowoJSON.encoder.encode(recs.results[0])
        let json = String(decoding: data, as: UTF8.self)
        XCTAssertTrue(json.contains("\"tmdb_id\":603"), json)
        XCTAssertTrue(json.contains("\"media_type\":\"movie\""), json)
        // Re-decode to prove the emitted body is itself contract-valid and the
        // snake_case fields round-trip (Foundation escapes `/` as `\/` in the
        // string, which the server unescapes on JSON.parse — hence check by
        // re-decoding rather than substring-matching the poster path).
        let reDecoded = try FilmowoJSON.decode(Card.self, from: data)
        XCTAssertEqual(reDecoded.key, "movie:603")
        XCTAssertEqual(reDecoded.posterPath, "/matrix.jpg")
        XCTAssertEqual(reDecoded.tones.map(\.slug), ["mind-bending", "dystopian"])
    }
}
