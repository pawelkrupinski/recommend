import XCTest
@testable import Filmowo
import FilmowoCore

/// Exercises `FilmowoClient` against a `URLProtocol` stub — no real network — so
/// the request/response contract (decoding, headers, conditional GET, error
/// mapping) is verified deterministically. Mirrors the Android `FilmowoApi`
/// MockWebServer tests.
final class FilmowoClientTests: XCTestCase {
    private func makeClient() -> FilmowoClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        let session = URLSession(configuration: config)
        return FilmowoClient(baseURL: URL(string: "https://test.local")!, session: session)
    }

    override func tearDown() {
        StubURLProtocol.handler = nil
        super.tearDown()
    }

    func testMeDecodes() async throws {
        StubURLProtocol.handler = { req in
            XCTAssertEqual(req.url?.path, "/api/me")
            return .ok(#"{"anonymous":false,"onboarded":true,"language":"pl","country":"PL","providers":["google"],"services":[8]}"#)
        }
        let me = try await makeClient().me()
        XCTAssertFalse(me.anonymous)
        XCTAssertTrue(me.onboarded)
        XCTAssertEqual(me.language, "pl")
        XCTAssertEqual(me.services, [8])
    }

    func testHeadersCarryRegionAndLanguage() async throws {
        let client = makeClient()
        client.deviceCountry = "PL"
        client.language = "pl"
        StubURLProtocol.handler = { req in
            XCTAssertEqual(req.value(forHTTPHeaderField: "X-Device-Country"), "PL")
            XCTAssertEqual(req.value(forHTTPHeaderField: "Accept-Language"), "pl")
            return .ok(#"{"genres":[]}"#)
        }
        _ = try await client.genres()
    }

    func testRecommendConditionalGetReusesCacheOn304() async throws {
        let client = makeClient()
        var calls = 0
        StubURLProtocol.handler = { req in
            calls += 1
            if req.value(forHTTPHeaderField: "If-None-Match") == "etag-1" {
                return StubURLProtocol.Stub(status: 304, headers: [:], body: Data())
            }
            return .ok(#"{"profileSize":12,"results":[{"tmdb_id":603,"media_type":"movie","title":"The Matrix"}]}"#,
                       headers: ["ETag": "etag-1"])
        }
        let first = try await client.recommend(RecommendQuery())
        XCTAssertEqual(first.results.first?.key, "movie:603")
        // Second call sends If-None-Match; the 304 must reuse the cached body.
        let second = try await client.recommend(RecommendQuery())
        XCTAssertEqual(second.results.first?.title, "The Matrix")
        XCTAssertEqual(calls, 2, "both calls hit the network; the second got a 304")
    }

    func testRefreshSkipsConditionalHeader() async throws {
        let client = makeClient()
        StubURLProtocol.handler = { req in
            XCTAssertNil(req.value(forHTTPHeaderField: "If-None-Match"), "refresh must not send a conditional header")
            return .ok(#"{"profileSize":12,"results":[]}"#, headers: ["ETag": "etag-1"])
        }
        _ = try await client.recommend(RecommendQuery())
        _ = try await client.recommend(RecommendQuery(refresh: true))
    }

    func testExchangePostsCodeToAuthEndpoint() async throws {
        StubURLProtocol.handler = { req in
            XCTAssertEqual(req.url?.path, "/auth/exchange")
            XCTAssertEqual(req.httpMethod, "POST")
            return .ok(#"{"ok":true}"#)
        }
        try await makeClient().exchange(code: "abc.def")
    }

    func testAuthStartURLTargetsIosPlatform() {
        let url = makeClient().authStartURL(provider: "google")
        XCTAssertEqual(url.path, "/auth/google")
        XCTAssertTrue(url.query?.contains("platform=ios") ?? false)
    }

    func testHttpErrorMapsToStatus() async {
        StubURLProtocol.handler = { _ in StubURLProtocol.Stub(status: 500, headers: [:], body: Data()) }
        do {
            _ = try await makeClient().me()
            XCTFail("expected an error")
        } catch let e as FilmowoError {
            XCTAssertEqual(e, .http(500))
        } catch { XCTFail("unexpected \(error)") }
    }

    func testTransportFailureMapsToOffline() async {
        StubURLProtocol.handler = nil // → stub fails the request
        do {
            _ = try await makeClient().me()
            XCTFail("expected an error")
        } catch let e as FilmowoError {
            XCTAssertEqual(e, .offline)
        } catch { XCTFail("unexpected \(error)") }
    }
}

/// A configurable in-process URL stub. Set `handler` to map a request to a
/// canned response; leave it nil to simulate a transport failure.
final class StubURLProtocol: URLProtocol {
    struct Stub {
        let status: Int; let headers: [String: String]; let body: Data
        static func ok(_ json: String, headers: [String: String] = [:]) -> Stub {
            var h = headers; h["Content-Type"] = "application/json"
            return Stub(status: 200, headers: h, body: Data(json.utf8))
        }
    }
    nonisolated(unsafe) static var handler: ((URLRequest) -> Stub)?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        let stub = handler(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: stub.status,
                                       httpVersion: "HTTP/1.1", headerFields: stub.headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: stub.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
