import Foundation
import FilmowoCore

/// In-app network stub for XCUITests. When the app is launched with the
/// `FILMOWO_UITEST` env var, the client is backed by canned `/api/*` responses
/// instead of the real server, so UI flows run deterministically and offline
/// (mirrors Kinowo's `KINOWO_UITEST_FIXTURE` hooks). Inert in normal launches.
enum UITestScenario: String {
    case firstRun = "firstrun"   // onboarded=false → first-run onboarding form
    case rateQueue = "ratequeue" // onboarded, but below the rate goal → Discover rate-queue
    case picks                   // onboarded, above the goal → personalized picks
}

/// A region source with no CoreLocation, so tests never hit a permission prompt.
struct FakeRegionSource: AppRegionSource {
    let code: String?
    func best() -> String? { code }
    func resolveGPS(geocode: (Double, Double) async throws -> String?) async -> String? { code }
}

extension AppModel {
    /// The app instance for launch: a stubbed client under UI test, else live.
    static func forLaunch() -> AppModel {
        let env = ProcessInfo.processInfo.environment
        if let raw = env["FILMOWO_UITEST"], let scenario = UITestScenario(rawValue: raw) {
            return AppModel(client: .uiTestStub(scenario: scenario), region: FakeRegionSource(code: "US"))
        }
        return AppModel()
    }
}

extension FilmowoClient {
    static func uiTestStub(scenario: UITestScenario) -> FilmowoClient {
        UITestStubProtocol.scenario = scenario
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [UITestStubProtocol.self]
        return FilmowoClient(baseURL: URL(string: "https://uitest.local")!,
                             session: URLSession(configuration: config))
    }
}

/// Serves canned responses keyed by path for the active scenario.
final class UITestStubProtocol: URLProtocol {
    nonisolated(unsafe) static var scenario: UITestScenario = .picks

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let path = request.url?.path ?? ""
        let json = Self.body(for: path, scenario: Self.scenario, method: request.httpMethod ?? "GET")
        let headers = ["Content-Type": path == "/api/enrich" ? "application/x-ndjson" : "application/json"]
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(json.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static func body(for path: String, scenario: UITestScenario, method: String) -> String {
        // Mutating endpoints just acknowledge — the stores update optimistically.
        if method == "POST" || method == "DELETE" { return #"{"ok":true}"# }
        switch path {
        case "/api/me":
            return scenario == .firstRun
                ? #"{"anonymous":true,"onboarded":false,"providers":["google","facebook"],"services":[],"country":null,"detectedCountry":"US","language":"en"}"#
                : #"{"user":{"email":"tester@example.com","name":"Tester"},"anonymous":false,"onboarded":true,"providers":["google","facebook"],"services":[8],"country":"US","language":"en","watchlistSort":"added"}"#
        case "/api/genres":
            return #"{"genres":[{"id":28,"name":"Action"},{"id":18,"name":"Drama"}]}"#
        case "/api/tones":
            return #"{"tones":[{"slug":"dark","label":"Dark"},{"slug":"feel-good","label":"Feel-good"}]}"#
        case "/api/providers":
            return #"{"providers":[{"id":8,"name":"Netflix","logo":null},{"id":337,"name":"Disney+","logo":null}]}"#
        case "/api/rate-queue":
            return rateQueueJSON
        case "/api/recommend":
            // Only the picks scenario has enough profile to return results.
            return scenario == .picks ? recommendJSON : #"{"profileSize":0,"results":[]}"#
        case "/api/watchlist":
            return watchlistJSON
        case "/api/ratings":
            return #"{"ratings":[{"tmdb_id":603,"media_type":"movie","rating":9.0,"title":"The Matrix","year":1999}]}"#
        case "/api/where":
            return #"{"region":"US","flatrate":[{"name":"Netflix","logo":null}],"deepLinks":[{"service":"Netflix","link":"https://www.netflix.com/title/20557937","providerId":8}],"credits":{}}"#
        case "/api/enrich":
            return #"{"key":"movie:603","imdbRating":8.7,"metascore":73,"tones":[{"slug":"mind-bending","label":"Mind-bending"}]}"#
        default:
            return "{}"
        }
    }

    private static let rateQueueJSON = """
    {"items":[
      {"tmdb_id":238,"title":"The Godfather","year":1972,"poster_path":"/g.jpg","vote_average":8.7},
      {"tmdb_id":155,"title":"The Dark Knight","year":2008,"poster_path":"/d.jpg","vote_average":8.5},
      {"tmdb_id":424,"title":"Schindler's List","year":1993,"poster_path":"/s.jpg","vote_average":8.6},
      {"tmdb_id":389,"title":"12 Angry Men","year":1957,"poster_path":"/a.jpg","vote_average":8.5},
      {"tmdb_id":129,"title":"Spirited Away","year":2001,"poster_path":"/sa.jpg","vote_average":8.5},
      {"tmdb_id":19404,"title":"Dilwale","year":1995,"poster_path":"/dd.jpg","vote_average":8.6}
    ],"totalPages":1}
    """

    private static let recommendJSON = """
    {"profileSize":20,"results":[
      {"tmdb_id":603,"media_type":"movie","title":"The Matrix","year":1999,"runtime":136,"poster_path":"/m.jpg","vote_average":8.2,"genres":["Action"],"genreIds":[28],"services":[{"id":8,"name":"Netflix","logo":null}]},
      {"tmdb_id":1399,"media_type":"tv","title":"Game of Thrones","year":2011,"seasons":8,"poster_path":"/g.jpg","vote_average":8.4,"genres":["Drama"],"genreIds":[18]},
      {"tmdb_id":27205,"media_type":"movie","title":"Inception","year":2010,"runtime":148,"poster_path":"/i.jpg","vote_average":8.4,"genres":["Action"],"genreIds":[28]},
      {"tmdb_id":13,"media_type":"movie","title":"Forrest Gump","year":1994,"runtime":142,"poster_path":"/f.jpg","vote_average":8.5,"genres":["Drama"],"genreIds":[18]}
    ]}
    """

    private static let watchlistJSON = """
    {"watchlist":[
      {"tmdb_id":27205,"media_type":"movie","title":"Inception","year":2010,"poster_path":"/i.jpg","genres":["Action"],"genreIds":[28]}
    ],"genres":[{"id":28,"name":"Action"}]}
    """
}
