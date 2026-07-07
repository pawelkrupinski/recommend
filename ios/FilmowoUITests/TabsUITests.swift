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
