import XCTest
@testable import FilmowoCore

/// The card-logo → deep-link matcher (ServiceMatch.swift), ported from the web
/// `matchServiceLink`. Tapping a service icon must find that service's watch URL
/// even when TMDB's provider id/name and the source's name don't line up.
final class ServiceMatchTests: XCTestCase {
    private func where_(_ links: [DeepLink], tmdb: String? = "https://tmdb/x") -> WhereInfo {
        WhereInfo(tmdbLink: tmdb, deepLinks: links)
    }

    func testExactProviderIdWins() {
        let info = where_([
            DeepLink(service: "Netflix", link: "https://netflix.com/title/1", providerId: 8),
            DeepLink(service: "Disney+", link: "https://disneyplus.com/movies/2", providerId: 337),
        ])
        XCTAssertEqual(info.deepLink(forProviderId: 337, name: "Disney Plus"), "https://disneyplus.com/movies/2")
    }

    func testFallsBackToBrandWhenIdDoesNotMatch() {
        // TMDB fragments Paramount+ into tier ids the source never tags; the brand
        // key ("paramount") bridges "Paramount Plus Premium" to the source's link.
        let info = where_([
            DeepLink(service: "Paramount+", link: "https://paramountplus.com/m/3", providerId: nil),
        ])
        XCTAssertEqual(info.deepLink(forProviderId: 531, name: "Paramount Plus Premium"), "https://paramountplus.com/m/3")
    }

    func testMaxRebrandFoldsIntoHbo() {
        let info = where_([
            DeepLink(service: "HBO Max", link: "https://play.hbomax.com/m/4", providerId: nil),
        ])
        // The card icon may still read "Max"; both collapse to the "hbo" brand.
        XCTAssertEqual(info.deepLink(forProviderId: 1899, name: "Max"), "https://play.hbomax.com/m/4")
    }

    func testNoConfidentMatchReturnsNil() {
        // So the caller can fall back to tmdbLink rather than open a wrong app.
        let info = where_([DeepLink(service: "Netflix", link: "https://netflix.com/title/1", providerId: 8)])
        XCTAssertNil(info.deepLink(forProviderId: 337, name: "Disney+"))
    }

    func testBrandKeyAndNormMirrorTheWeb() {
        XCTAssertEqual(norm("Disney+"), "disney")
        XCTAssertEqual(brandKey("Disney Plus"), "disney")
        XCTAssertEqual(brandKey("HBO Max"), "hbo")
        XCTAssertEqual(brandKey("Showtime"), "paramount")
        XCTAssertEqual(brandKey("Cinemax"), "cinemax") // not HBO Max
    }
}
