import XCTest

extension XCUIApplication {
    /// Launch the app with the in-app network stub for a scenario.
    static func launch(scenario: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["FILMOWO_UITEST"] = scenario
        app.launch()
        return app
    }

    /// Tap a tab by its visible name, robust across iPhone (bottom tab bar) and
    /// iPad (where `TabView` renders tabs outside a `tabBar`).
    func tapTab(_ name: String) {
        let inBar = tabBars.buttons[name]
        if inBar.waitForExistence(timeout: 3) {
            inBar.tap()
        } else {
            buttons[name].firstMatch.tap()
        }
    }

    /// The card container elements currently on screen (identifier `card-<key>`,
    /// which always contains a colon — unlike the `card-save`/`card-dismiss`
    /// action buttons).
    var cards: [XCUIElement] {
        let q = otherElements.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND identifier CONTAINS %@", "card-", ":"))
        return (0..<q.count).map { q.element(boundBy: $0) }
    }
}

extension XCTestCase {
    /// Assert at least two cards share a row — i.e. the grid renders ≥2 columns,
    /// the Android "always ≥2 columns" guarantee.
    func assertAtLeastTwoColumns(_ cards: [XCUIElement], file: StaticString = #filePath, line: UInt = #line) {
        let frames = cards.prefix(6).map(\.frame)
        for i in frames.indices {
            for j in frames.indices where j > i {
                if abs(frames[i].minY - frames[j].minY) < 24 && abs(frames[i].minX - frames[j].minX) > 24 {
                    return
                }
            }
        }
        XCTFail("no two cards share a row → fewer than 2 columns", file: file, line: line)
    }
}
