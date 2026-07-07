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
}
