import XCTest
@testable import Filmowo

/// Host-app XCTest target. Real client/store tests land in the networking
/// slice (driven through a `URLProtocol` stub). This smoke test just proves
/// the target links against the app and runs on the simulator.
final class SmokeTests: XCTestCase {
    func testAppTargetLinks() {
        XCTAssertNotNil(RootView())
    }
}
