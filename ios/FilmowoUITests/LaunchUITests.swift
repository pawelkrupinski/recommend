import XCTest

/// UI smoke test: the app launches and stays in the foreground. Fuller flows
/// (onboarding → picks, rating, watchlist, settings) land in the final slice
/// with launch-env fixture injection.
final class LaunchUITests: XCTestCase {
    func testLaunches() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertEqual(app.state, .runningForeground)
    }
}
