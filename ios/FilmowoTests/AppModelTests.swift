import XCTest
@testable import Filmowo
import FilmowoCore

/// Verifies `AppModel`'s boot routing, in particular that refreshing identity
/// after sign-in re-routes to match `me.onboarded` — signing into an already
/// onboarded account on the onboarding screen lands on Discover (mirrors
/// Android, which derives the screen reactively from `me`).
@MainActor
final class AppModelTests: XCTestCase {
    private func makeClient() -> FilmowoClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        return FilmowoClient(baseURL: URL(string: "https://test.local")!, session: URLSession(configuration: config))
    }

    override func tearDown() { StubURLProtocol.handler = nil; super.tearDown() }

    func testSignInOnOnboardingRoutesToReadyForOnboardedAccount() async {
        // Anonymous, not-yet-onboarded session first; an onboarded account after sign-in.
        var signedIn = false
        StubURLProtocol.handler = { req in
            guard req.url!.path == "/api/me" else { return .ok("{}") }
            return signedIn
                ? .ok(#"{"user":{"email":"t@example.com"},"anonymous":false,"onboarded":true,"providers":["google"],"services":[8],"country":"US","language":"en"}"#)
                : .ok(#"{"anonymous":true,"onboarded":false,"providers":["google"],"services":[],"country":null,"detectedCountry":"US","language":"en"}"#)
        }
        let app = AppModel(client: makeClient(), region: FakeRegionSource(code: "US"))

        await app.start()
        XCTAssertEqual(app.boot, .onboarding, "anonymous, not-onboarded → onboarding screen")

        // Simulate OAuth completing, then the sign-in refresh the onboarding screen runs.
        signedIn = true
        await app.refreshMe()
        XCTAssertEqual(app.boot, .ready, "onboarded account after sign-in → Discover")
        XCTAssertEqual(app.me?.anonymous, false)
    }

    func testRefreshStaysOnOnboardingForNotYetOnboardedAccount() async {
        StubURLProtocol.handler = { req in
            req.url!.path == "/api/me"
                ? .ok(#"{"anonymous":false,"onboarded":false,"providers":["google"],"services":[],"language":"en"}"#)
                : .ok("{}")
        }
        let app = AppModel(client: makeClient(), region: FakeRegionSource(code: "US"))
        app.boot = .onboarding

        await app.refreshMe()
        XCTAssertEqual(app.boot, .onboarding, "signed in but not onboarded → keep onboarding")
    }
}
