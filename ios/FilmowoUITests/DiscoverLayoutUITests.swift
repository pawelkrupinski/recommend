import XCTest

/// Guards the Discover top layout: the title is inline, so it renders as a
/// compact navigation bar with the filter dropdowns tucked directly beneath it,
/// instead of a tall large-title bar that opens a gap above the filters
/// (mirrors Android's compact top bar).
final class DiscoverLayoutUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    func testDiscoverUsesCompactInlineTitleAboveFilters() {
        let app = XCUIApplication.launch(scenario: "picks")
        let filterType = app.buttons["discover-filter-type"]
        XCTAssertTrue(filterType.waitForExistence(timeout: 10), "filter dropdowns are shown on picks")

        let navBar = app.navigationBars["Discover"]
        XCTAssertTrue(navBar.waitForExistence(timeout: 5))
        // An inline title is a standard ~44pt bar; a large title is ~96pt+. The
        // compact bar is what removes the gap above the filter dropdowns.
        XCTAssertLessThan(navBar.frame.height, 70,
                          "Discover uses an inline (compact) title, not a tall large-title bar")
        // The filters sit below the bar, near the top of the screen.
        XCTAssertGreaterThan(filterType.frame.minY, navBar.frame.maxY,
                             "filter dropdowns sit directly beneath the top bar")
    }

    /// Cards in a grid row line up — poster tops, year lines, and star rows — even
    /// when one card has ratings badges and a tone chip and its neighbour has
    /// neither (their reserved rows keep every card the same height).
    func testGridRowCardsAlignPostersYearsAndStars() {
        let app = XCUIApplication.launch(scenario: "picks")
        let matrix = app.otherElements["card-movie:603"]   // has badges + a tone chip
        let got = app.otherElements["card-tv:1399"]         // has neither
        XCTAssertTrue(matrix.waitForExistence(timeout: 10))
        XCTAssertTrue(got.waitForExistence(timeout: 5))
        // Make sure Matrix's extra content has loaded, so it is the taller-content card.
        XCTAssertTrue(app.staticTexts["Mind-bending"].waitForExistence(timeout: 5))

        XCTAssertEqual(matrix.frame.minY, got.frame.minY, accuracy: 1,
                       "poster tops line up across the row")

        let matrixYear = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "1999")).firstMatch
        let gotYear = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "2011")).firstMatch
        XCTAssertTrue(matrixYear.exists && gotYear.exists)
        XCTAssertEqual(matrixYear.frame.minY, gotYear.frame.minY, accuracy: 1,
                       "year lines line up across the row")

        let matrixStars = matrix.otherElements["rate-stars"]
        let gotStars = got.otherElements["rate-stars"]
        XCTAssertTrue(matrixStars.exists && gotStars.exists)
        XCTAssertEqual(matrixStars.frame.minY, gotStars.frame.minY, accuracy: 1,
                       "star rows line up across the row")
    }

    /// The card meta line shows the year (and runtime) but no longer the TMDB
    /// community rating — the "⭐ 8.2" was dropped in favour of the IMDb/MC badges.
    /// (movie:603's stub carries vote_average 8.2, so this would render before.)
    func testCardMetaLineDropsTmdbStarRating() {
        let app = XCUIApplication.launch(scenario: "picks")
        let matrix = app.otherElements["card-movie:603"]
        XCTAssertTrue(matrix.waitForExistence(timeout: 10))
        // The year line is still present…
        let year = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "1999")).firstMatch
        XCTAssertTrue(year.waitForExistence(timeout: 5), "the card still shows the year")
        // …but nothing on the card carries the ⭐ TMDB rating.
        let starred = matrix.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "⭐"))
        XCTAssertEqual(starred.count, 0, "the card no longer shows the TMDB ⭐ rating")
    }

    /// The IMDb rating renders as the two-tone pill (an "IMDb" tab + the value),
    /// matching Android / ../movies, rather than a bare starred number.
    func testImdbRatingShowsAsLabelledPill() {
        let app = XCUIApplication.launch(scenario: "picks")
        let matrix = app.otherElements["card-movie:603"]
        XCTAssertTrue(matrix.waitForExistence(timeout: 10))
        XCTAssertTrue(matrix.staticTexts["IMDb"].waitForExistence(timeout: 5),
                      "the IMDb pill carries an 'IMDb' label tab")
        XCTAssertTrue(matrix.staticTexts["8.7"].exists, "and its value")
    }
}
