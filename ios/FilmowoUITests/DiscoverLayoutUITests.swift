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
}
