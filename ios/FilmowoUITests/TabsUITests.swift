import XCTest

/// Drives the Watchlist, Ratings, and Settings tabs against the stub, including
/// the interface-language switch that re-localizes the whole UI.
final class TabsUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    func testWatchlistListsSavedTitle() {
        let app = XCUIApplication.launch(scenario: "picks")
        app.tapTab("Watchlist")
        XCTAssertTrue(app.staticTexts["Inception"].waitForExistence(timeout: 10))
    }

    func testRatingsListsRatedTitle() {
        let app = XCUIApplication.launch(scenario: "picks")
        app.tapTab("Ratings")
        XCTAssertTrue(app.staticTexts["The Matrix"].waitForExistence(timeout: 10))
    }

    func testRatingsRowRemoveButtonDeletesTheRating() {
        let app = XCUIApplication.launch(scenario: "picks")
        app.tapTab("Ratings")
        XCTAssertTrue(app.staticTexts["The Matrix"].waitForExistence(timeout: 10))
        // The visible per-row trash button (alongside swipe-to-remove).
        app.buttons["rating-remove-movie:603"].tap()
        XCTAssertTrue(app.staticTexts["The Matrix"].waitForNonExistence(timeout: 5),
                      "the per-row remove button deletes the rating")
    }

    func testRatingsRowShowsTitleAndYearOnOneRowWithStarsBelow() {
        let app = XCUIApplication.launch(scenario: "picks")
        app.tapTab("Ratings")
        let title = app.staticTexts["The Matrix"]
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        let year = app.staticTexts["1999"]
        XCTAssertTrue(year.waitForExistence(timeout: 5))
        // Title and year now share one row (before: year sat on its own line below).
        XCTAssertLessThan(abs(title.frame.minY - year.frame.minY), 8,
                          "title and year are on the same row")
        // On iPhone (compact) the stars drop to the row below the title.
        let firstStar = app.buttons["rate-star-1"].firstMatch
        XCTAssertTrue(firstStar.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(firstStar.frame.minY, title.frame.minY,
                             "stars sit on the row below the title")
    }

    func testWatchlistHasNoCountHeader() {
        let app = XCUIApplication.launch(scenario: "picks")
        app.tapTab("Watchlist")
        XCTAssertTrue(app.staticTexts["Inception"].waitForExistence(timeout: 10))
        let counts = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "saved titles"))
        XCTAssertEqual(counts.count, 0, "the watchlist count header was removed")
    }

    func testSwipeLeftRightSwitchesTabs() {
        let app = XCUIApplication.launch(scenario: "picks")
        // Starts on Discover (The Matrix pick present).
        XCTAssertTrue(app.otherElements["card-movie:603"].waitForExistence(timeout: 10))
        // Swipe left → the next tab (Watchlist, listing Inception).
        app.swipeLeft()
        XCTAssertTrue(app.staticTexts["Inception"].waitForExistence(timeout: 10),
                      "swiping left advances to the next tab")
        // Swipe right → back to the previous tab (Discover).
        app.swipeRight()
        XCTAssertTrue(app.otherElements["card-movie:603"].waitForExistence(timeout: 10),
                      "swiping right returns to the previous tab")
    }

    func testSettingsLanguageSwitchRelocalizes() {
        let app = XCUIApplication.launch(scenario: "picks")
        app.tapTab("Settings")
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10))
        // Flip the segmented language control to Polish.
        app.buttons["Polski"].firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Ustawienia"].waitForExistence(timeout: 5),
                      "switching language re-localizes the UI")
    }
}
