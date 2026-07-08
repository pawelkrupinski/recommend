import XCTest

/// Verifies drag-to-rate: pressing on the stars and dragging horizontally across
/// them (not a tap) previews and commits a rating, which removes the rated item
/// from the rate-queue. Guards the Android-parity drag gesture on both iPhone
/// and iPad.
final class RateStarsDragUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    func testDraggingAcrossStarsRatesTheItem() {
        let app = XCUIApplication.launch(scenario: "ratequeue")
        let card = app.otherElements["card-movie:238"]
        XCTAssertTrue(card.waitForExistence(timeout: 10))

        // A horizontal drag across the top row: down on star 1, up on star 5.
        // Far enough to be a drag, not a tap, so only the drag gesture can commit.
        let from = card.buttons["rate-star-1"].firstMatch
        let to = card.buttons["rate-star-5"].firstMatch
        XCTAssertTrue(from.waitForExistence(timeout: 5))
        from.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .press(forDuration: 0.15,
                   thenDragTo: to.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)))

        XCTAssertTrue(card.waitForNonExistence(timeout: 5),
                      "dragging across the stars rates the item and removes it from the queue")
    }

    /// A vertical drag that starts on the stars scrolls the grid (rather than being
    /// swallowed by the rating gesture) and does not rate. Uses the rate-queue,
    /// whose tall cards overflow a phone screen so there is room to scroll.
    func testVerticalDragFromStarsScrollsTheGrid() throws {
        let app = XCUIApplication.launch(scenario: "ratequeue")
        let card = app.otherElements["card-movie:238"]
        XCTAssertTrue(card.waitForExistence(timeout: 10))
        let stars = card.otherElements["rate-stars"]
        XCTAssertTrue(stars.waitForExistence(timeout: 5))
        let before = card.frame.minY

        // Press on the stars and drag up toward the top of the screen.
        stars.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .press(forDuration: 0.1,
                   thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1)))
        XCTAssertTrue(card.exists, "the card is still there — the drag scrolled, it didn't rate")

        if card.frame.minY < before - 20 { return } // scrolled from the stars — done

        // It didn't scroll. Only a failure if the grid actually *can* scroll — on a
        // very large screen the few cards fit and nothing scrolls (then skip).
        app.swipeUp()
        try XCTSkipIf(card.frame.minY >= before - 20, "grid fits the screen; nothing to scroll")
        XCTFail("a vertical drag starting on the stars did not scroll, though the grid scrolls")
    }

    /// Dragging across the stars and then off them (lifting outside the stars)
    /// does not rate — starAt returns 0 off the block, so nothing commits.
    func testDraggingOffTheStarsDoesNotRate() {
        let app = XCUIApplication.launch(scenario: "ratequeue")
        let card = app.otherElements["card-movie:238"]
        XCTAssertTrue(card.waitForExistence(timeout: 10))
        let star = card.buttons["rate-star-1"].firstMatch
        XCTAssertTrue(star.waitForExistence(timeout: 5))

        // A horizontal drag that continues off the right end of the stars and lifts
        // there — the finger left the stars, so nothing should be rated.
        star.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .press(forDuration: 0.1,
                   thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5)))

        XCTAssertTrue(card.waitForExistence(timeout: 3),
                      "lifting off the stars leaves the item unrated (still in the queue)")
    }

    /// Tapping a star rates the card (removing it from the feed) without also
    /// opening the detail sheet — the stars sit outside the card's tap target.
    func testTappingStarRatesWithoutOpeningDetail() {
        let app = XCUIApplication.launch(scenario: "picks")
        let matrix = app.otherElements["card-movie:603"]
        XCTAssertTrue(matrix.waitForExistence(timeout: 10))
        matrix.buttons["rate-star-9"].firstMatch.tap()
        XCTAssertTrue(matrix.waitForNonExistence(timeout: 5), "the star tap rated the card")
        XCTAssertFalse(app.otherElements["detail-sheet"].exists, "and did not open the detail sheet")
    }
}
