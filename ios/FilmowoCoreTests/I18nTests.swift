import XCTest
@testable import FilmowoCore

final class I18nTests: XCTestCase {
    /// Every English key must have a Polish translation (and vice-versa) — a
    /// missing key would silently fall back to English mid-UI.
    func testEnAndPlHaveIdenticalKeys() {
        let en = Set(I18n.en.keys)
        let pl = Set(I18n.pl.keys)
        XCTAssertEqual(en, pl, "en/pl catalogs drifted: \(en.symmetricDifference(pl).sorted())")
        XCTAssertFalse(en.isEmpty)
    }

    func testLookupPrefersRequestedLanguage() {
        XCTAssertEqual(I18n.t("pl", "nav.discover"), "Odkrywaj")
        XCTAssertEqual(I18n.t("en", "nav.discover"), "Discover")
    }

    func testUnknownLanguageFallsBackToEnglish() {
        XCTAssertEqual(I18n.t("de", "nav.settings"), "Settings")
    }

    func testUnknownKeyReturnsKeyItself() {
        XCTAssertEqual(I18n.t("en", "no.such.key"), "no.such.key")
    }

    func testPlaceholderFillsAreSubstituted() {
        XCTAssertEqual(I18n.t("en", "discover.rateMore", ["n": "3"]), "Rate 3 more to unlock your picks")
        XCTAssertEqual(I18n.t("pl", "watchlist.count", ["n": "7"]), "Zapisane tytuły: 7")
    }
}
