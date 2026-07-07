import XCTest
@testable import Filmowo

/// Verifies `RateStars.starAt` maps a drag position to the 1–10 star under the
/// finger across two rows of five (mirrors Android's `starAt` unit test): the
/// row picks 1–5 vs 6–10, the column picks within it, and off-block positions
/// return 0 so a lift outside the stars commits nothing.
final class RateStarsTests: XCTestCase {
    // A 100×40 block: two 20pt-high rows, five 20pt-wide columns.
    private let w: CGFloat = 100, h: CGFloat = 40
    private let rows = 2
    private var vSlop: CGFloat { h / CGFloat(rows) * 3 }

    private func star(_ x: CGFloat, _ y: CGFloat) -> Int {
        RateStars.starAt(x, y, w, h, rows, vSlop)
    }

    func testTopRowMapsToOneThroughFive() {
        XCTAssertEqual(star(0, 5), 1)    // first column, top row
        XCTAssertEqual(star(45, 5), 3)   // middle column
        XCTAssertEqual(star(99, 5), 5)   // last column
    }

    func testBottomRowMapsToSixThroughTen() {
        XCTAssertEqual(star(0, 35), 6)   // first column, bottom row
        XCTAssertEqual(star(99, 35), 10) // last column, bottom row
    }

    func testColumnBoundaries() {
        XCTAssertEqual(star(19, 5), 1)   // still first 20pt column
        XCTAssertEqual(star(20, 5), 2)   // crosses into second column
    }

    func testOffTheSidesReturnsZero() {
        XCTAssertEqual(star(-1, 5), 0)
        XCTAssertEqual(star(101, 5), 0)
    }

    func testWithinVerticalSlackClampsToNearestRow() {
        // A little above the top / below the bottom still counts (finger drift).
        XCTAssertEqual(star(45, -10), 3)  // within vSlop above → top row
        XCTAssertEqual(star(45, 50), 8)   // within vSlop below → bottom row
    }

    func testBeyondVerticalSlackReturnsZero() {
        XCTAssertEqual(star(45, -vSlop - 1), 0)
        XCTAssertEqual(star(45, h + vSlop + 1), 0)
    }

    func testZeroSizedBlockReturnsZero() {
        XCTAssertEqual(RateStars.starAt(5, 5, 0, 0, rows, vSlop), 0)
    }
}
