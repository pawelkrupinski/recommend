import XCTest
@testable import FilmowoCore

final class RegionResolverTests: XCTestCase {
    func testPicksFirstWellFormedCandidate() {
        XCTAssertEqual(RegionResolver.pickCountry(nil, "pl", "US"), "PL")
    }

    func testSkipsMalformedCandidates() {
        XCTAssertEqual(RegionResolver.pickCountry("", "USA", "12", "gb"), "GB")
    }

    func testUppercasesAndTrims() {
        XCTAssertEqual(RegionResolver.pickCountry("  de  "), "DE")
    }

    func testReturnsNilWhenNoneValid() {
        XCTAssertNil(RegionResolver.pickCountry(nil, "", "USA", "1"))
    }

    func testLocaleRegionSourceUsesInjectedRegion() {
        XCTAssertEqual(LocaleRegionSource(localeRegion: "fr").best(), "FR")
        XCTAssertNil(LocaleRegionSource(localeRegion: nil).best())
    }
}

final class EndpointTests: XCTestCase {
    func testEmptyQueryHasNoItems() {
        XCTAssertTrue(RecommendQuery().queryItems().isEmpty)
    }

    func testFlagsBecomeOneOnlyWhenTrue() {
        let items = RecommendQuery(indie: true, excludeUs: false, refresh: true).queryItems()
        let dict = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value) })
        XCTAssertEqual(dict["indie"], "1")
        XCTAssertEqual(dict["refresh"], "1")
        XCTAssertNil(dict["excludeUs"])
    }

    func testBlankStringsAreOmitted() {
        let items = RecommendQuery(type: "  ", genre: "").queryItems()
        XCTAssertTrue(items.isEmpty)
    }

    func testValuesPassThrough() {
        let items = RecommendQuery(type: "tv", genre: "Drama", tag: "dark", origin: "EU").queryItems()
        let dict = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value) })
        XCTAssertEqual(dict["type"], "tv")
        XCTAssertEqual(dict["genre"], "Drama")
        XCTAssertEqual(dict["tag"], "dark")
        XCTAssertEqual(dict["origin"], "EU")
    }

    func testEnrichIdsJoinKeys() {
        let cards = [Card(tmdbId: 1399, mediaType: "tv"), Card(tmdbId: 603, mediaType: "movie")]
        XCTAssertEqual(Endpoints.enrichIds(cards), "tv:1399,movie:603")
    }
}
