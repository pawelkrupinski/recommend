import XCTest

/// Drives the Discover flows against the in-app network stub: onboarding
/// rate-queue, personalized picks, the ≥2-column grid guarantee, rating, and the
/// detail sheet. Readiness is keyed off card elements / known text rather than
/// the ScrollView container (a ScrollView's identifier isn't surfaced to XCUI).
final class DiscoverFlowUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    func testFirstRunOnboardingFormLeadsIntoTheApp() {
        let app = XCUIApplication.launch(scenario: "firstrun")
        XCTAssertTrue(app.navigationBars["Welcome to Filmowo"].waitForExistence(timeout: 10),
                      "first-run onboarding form is shown")
        let start = app.buttons["onboarding-start"]
        if !start.waitForExistence(timeout: 3) { app.swipeUp() } // reveal it in the lazy Form
        start.tap()
        // Completing onboarding drops into the main tabs (Discover tab present on
        // both iPhone's bottom bar and iPad's TabView).
        XCTAssertTrue(app.buttons["Discover"].firstMatch.waitForExistence(timeout: 10))
    }

    func testRateQueueGridShowsCountdownAndColumns() {
        let app = XCUIApplication.launch(scenario: "ratequeue")
        XCTAssertTrue(app.otherElements["card-movie:238"].waitForExistence(timeout: 10))
        // The countdown header reflects RATE_GOAL - 0 = 10.
        XCTAssertTrue(app.staticTexts["Rate 10 more to unlock your picks"].exists)
        assertAtLeastTwoColumns(app.cards)
    }

    func testRatingAQueueItemRemovesIt() {
        let app = XCUIApplication.launch(scenario: "ratequeue")
        let godfather = app.otherElements["card-movie:238"]
        XCTAssertTrue(godfather.waitForExistence(timeout: 10))
        godfather.buttons["rate-star-8"].firstMatch.tap()
        XCTAssertTrue(godfather.waitForNonExistence(timeout: 5), "rated title leaves the queue")
    }

    func testPicksGridHasAtLeastTwoColumns() {
        let app = XCUIApplication.launch(scenario: "picks")
        XCTAssertTrue(app.otherElements["card-movie:603"].waitForExistence(timeout: 10))
        assertAtLeastTwoColumns(app.cards)
    }

    func testPickCardShowsItsServiceLogo() {
        let app = XCUIApplication.launch(scenario: "picks")
        // The Matrix (movie:603) streams on Netflix (service id 8) in the stub;
        // the card overlays that service's logo next to the poster.
        let matrix = app.otherElements["card-movie:603"]
        XCTAssertTrue(matrix.waitForExistence(timeout: 10))
        XCTAssertTrue(matrix.images[AXIDs.serviceLogo(8)].waitForExistence(timeout: 5),
                      "the card badges the streaming service with its logo")
    }

    func testTappingAPickOpensDetailSheet() {
        let app = XCUIApplication.launch(scenario: "picks")
        XCTAssertTrue(app.staticTexts["The Matrix"].waitForExistence(timeout: 10))
        app.staticTexts["The Matrix"].firstMatch.tap()
        XCTAssertTrue(app.otherElements[AXIDs.detailSheet].waitForExistence(timeout: 5))
        app.buttons[AXIDs.detailClose].tap()
        XCTAssertTrue(app.otherElements[AXIDs.detailSheet].waitForNonExistence(timeout: 5))
    }

    func testDismissingAPickViaTheXRemovesIt() {
        let app = XCUIApplication.launch(scenario: "picks")
        let matrix = app.otherElements["card-movie:603"]
        XCTAssertTrue(matrix.waitForExistence(timeout: 10))
        matrix.buttons["card-dismiss"].tap()
        XCTAssertTrue(matrix.waitForNonExistence(timeout: 5), "the top-left X dismisses the pick")
    }

    func testDetailSheetShowsWhereToWatchBanner() {
        let app = XCUIApplication.launch(scenario: "picks")
        XCTAssertTrue(app.staticTexts["The Matrix"].waitForExistence(timeout: 10))
        app.staticTexts["The Matrix"].firstMatch.tap()
        let sheet = app.otherElements[AXIDs.detailSheet]
        XCTAssertTrue(sheet.waitForExistence(timeout: 5))
        // The stub's /api/where returns a Netflix deep link; it renders as a
        // tappable where-to-watch banner (a button labelled with the service).
        XCTAssertTrue(sheet.buttons["Netflix"].waitForExistence(timeout: 5),
                      "the streaming service shows as a tappable banner in the popup")
    }

    func testRatingAPickRemovesItFromTheFeed() {
        let app = XCUIApplication.launch(scenario: "picks")
        let matrix = app.otherElements["card-movie:603"]
        XCTAssertTrue(matrix.waitForExistence(timeout: 10))
        matrix.buttons["rate-star-9"].firstMatch.tap()
        XCTAssertTrue(matrix.waitForNonExistence(timeout: 5), "rating a pick moves it out of Discover")
    }
}

/// String constants mirrored from the app's `AXID` (the UI test target can't
/// import the app module).
enum AXIDs {
    static let detailSheet = "detail-sheet"
    static let detailClose = "detail-close"
    static func serviceLogo(_ id: Int) -> String { "service-logo-\(id)" }
}
