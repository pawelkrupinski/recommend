import XCTest

/// UI smoke test: the app launches and shows its name. Fuller flows
/// (onboarding → picks, rating, watchlist, settings) land in the final slice
/// with launch-env fixture injection.
final class LaunchUITests: XCTestCase {
    func testLaunches() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["Filmowo"].waitForExistence(timeout: 10))
    }
}
