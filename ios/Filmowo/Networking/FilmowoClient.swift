import Foundation
import FilmowoCore

/// Errors surfaced to the UI. `.offline` maps to the localized "couldn't reach
/// the server" copy; `.http` carries a status for diagnostics.
public enum FilmowoError: Error, Equatable {
    case offline
    case http(Int)
    case decoding
}

/// The single seam onto the server's `/api/*` + `/auth/*` contract. One async
/// method per endpoint, mirroring the Android `FilmowoApi`. Session state is a
/// cookie (`rid`) held by the injected `URLSession`'s cookie storage, so login
/// survives relaunch (see ``FilmowoClient/live``). Region and language ride on
/// every request as `X-Device-Country` / `Accept-Language`, matching Android's
/// `LocaleHeaderInterceptor` + `DeviceRegion`.
public final class FilmowoClient {
    private let baseURL: URL
    private let session: URLSession

    /// Best-known streaming region (ISO alpha-2), set by the location layer.
    public var deviceCountry: String?
    /// UI language for `Accept-Language` (the user's setting, else device).
    public var language: String?

    /// Cached ETag for `/api/recommend`, enabling conditional GETs (304 → reuse).
    private var recommendETag: String?
    private var recommendCache: Recommendations?

    public init(baseURL: URL, session: URLSession) {
        self.baseURL = baseURL
        self.session = session
    }

    /// The production client: base URL from `FILMOWO_BASE_URL` (settable via the
    /// run scheme / launch env for local dev), else the Fly deployment. Uses a
    /// persistent shared cookie jar so `rid` outlives the process.
    public static func live() -> FilmowoClient {
        let raw = ProcessInfo.processInfo.environment["FILMOWO_BASE_URL"] ?? "https://filmowo.fly.dev"
        let base = URL(string: raw) ?? URL(string: "https://filmowo.fly.dev")!
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = .shared
        config.httpShouldSetCookies = true
        config.httpCookieAcceptPolicy = .always
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.waitsForConnectivity = true
        return FilmowoClient(baseURL: base, session: URLSession(configuration: config))
    }

    // MARK: - Request plumbing

    private func url(_ path: String, _ items: [URLQueryItem] = []) -> URL {
        var comps = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !items.isEmpty { comps.queryItems = items }
        return comps.url!
    }

    private func request(_ path: String, method: String = "GET", query: [URLQueryItem] = [],
                         body: Encodable? = nil, extraHeaders: [String: String] = [:]) -> URLRequest {
        var req = URLRequest(url: url(path, query))
        req.httpMethod = method
        if let country = deviceCountry { req.setValue(country, forHTTPHeaderField: "X-Device-Country") }
        if let language { req.setValue(language, forHTTPHeaderField: "Accept-Language") }
        for (k, v) in extraHeaders { req.setValue(v, forHTTPHeaderField: k) }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? FilmowoJSON.encoder.encode(AnyEncodable(body))
        }
        return req
    }

    private func data(for req: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, resp) = try await session.data(for: req)
            guard let http = resp as? HTTPURLResponse else { throw FilmowoError.offline }
            return (data, http)
        } catch let e as FilmowoError {
            throw e
        } catch {
            throw FilmowoError.offline
        }
    }

    /// GET + decode, treating any non-2xx as an error.
    private func get<T: Decodable>(_ type: T.Type, _ path: String, _ query: [URLQueryItem] = []) async throws -> T {
        let (data, http) = try await data(for: request(path, query: query))
        guard (200..<300).contains(http.statusCode) else { throw FilmowoError.http(http.statusCode) }
        do { return try FilmowoJSON.decode(type, from: data) } catch { throw FilmowoError.decoding }
    }

    /// Fire-and-check a mutating request; returns nothing but throws on failure.
    @discardableResult
    private func send(_ path: String, method: String, body: Encodable? = nil) async throws -> Int {
        let (_, http) = try await data(for: request(path, method: method, body: body))
        guard (200..<300).contains(http.statusCode) else { throw FilmowoError.http(http.statusCode) }
        return http.statusCode
    }

    // MARK: - Reads

    public func me() async throws -> Me { try await get(Me.self, "/api/me") }
    public func genres() async throws -> GenresResponse { try await get(GenresResponse.self, "/api/genres") }
    public func tones() async throws -> TonesResponse { try await get(TonesResponse.self, "/api/tones") }
    public func watchlist() async throws -> WatchlistResponse { try await get(WatchlistResponse.self, "/api/watchlist") }
    public func ratings() async throws -> RatingsResponse { try await get(RatingsResponse.self, "/api/ratings") }
    public func origins() async throws -> OriginsResponse { try await get(OriginsResponse.self, "/api/origins") }

    public func providers(region: String?) async throws -> ProvidersResponse {
        try await get(ProvidersResponse.self, "/api/providers", region.map { [URLQueryItem(name: "region", value: $0)] } ?? [])
    }

    /// `/api/search?q=…` → the cards whose title matches `q`, server-sorted
    /// on-service-first. Mirrors the web/floating search box.
    public func search(_ q: String) async throws -> [Card] {
        try await get(SearchResponse.self, "/api/search", [URLQueryItem(name: "q", value: q)]).results
    }

    public func rateQueue(page: Int) async throws -> RateQueue {
        try await get(RateQueue.self, "/api/rate-queue", [URLQueryItem(name: "page", value: String(page))])
    }

    public func geocode(lat: Double, lng: Double) async throws -> String? {
        try await get(GeocodeResponse.self, "/api/geocode",
                      [URLQueryItem(name: "lat", value: String(lat)), URLQueryItem(name: "lng", value: String(lng))]).country
    }

    public func whereToWatch(tmdbId: Int, mediaType: String, region: String?) async throws -> WhereInfo {
        var q = [URLQueryItem(name: "id", value: String(tmdbId)), URLQueryItem(name: "media_type", value: mediaType)]
        if let region { q.append(URLQueryItem(name: "region", value: region)) }
        return try await get(WhereInfo.self, "/api/where", q)
    }

    /// `/api/recommend` with an ETag conditional GET: a 304 reuses the last body,
    /// matching Android's `If-None-Match` handling.
    public func recommend(_ query: RecommendQuery) async throws -> Recommendations {
        var headers: [String: String] = [:]
        if !query.refresh, let tag = recommendETag { headers["If-None-Match"] = tag }
        let (data, http) = try await data(for: request("/api/recommend", query: query.queryItems(), extraHeaders: headers))
        if http.statusCode == 304, let cached = recommendCache { return cached }
        guard (200..<300).contains(http.statusCode) else { throw FilmowoError.http(http.statusCode) }
        let recs: Recommendations
        do { recs = try FilmowoJSON.decode(Recommendations.self, from: data) } catch { throw FilmowoError.decoding }
        recommendETag = http.value(forHTTPHeaderField: "ETag")
        recommendCache = recs
        return recs
    }

    /// Stream `/api/enrich` NDJSON, yielding each row as it lands so cards can
    /// fill in IMDb/Metacritic badges + tones progressively.
    public func enrich(_ cards: [Card]) -> AsyncThrowingStream<EnrichRow, Error> {
        let ids = Endpoints.enrichIds(cards)
        let req = request("/api/enrich", query: [URLQueryItem(name: "ids", value: ids)])
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let (bytes, resp) = try await session.bytes(for: req)
                    guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                        throw FilmowoError.http((resp as? HTTPURLResponse)?.statusCode ?? -1)
                    }
                    for try await line in bytes.lines {
                        let trimmed = line.trimmingCharacters(in: .whitespaces)
                        guard !trimmed.isEmpty, let d = trimmed.data(using: .utf8) else { continue }
                        if let row = try? FilmowoJSON.decode(EnrichRow.self, from: d) { continuation.yield(row) }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: - Writes

    public func rate(tmdbId: Int, mediaType: String, rating: Double, title: String?, year: Int?) async throws {
        try await send("/api/ratings", method: "POST", body: RatePayload(
            tmdb_id: tmdbId, media_type: mediaType, rating: rating, title: title, year: year))
    }
    public func unrate(tmdbId: Int, mediaType: String) async throws {
        try await send("/api/ratings", method: "DELETE", body: IdPayload(tmdb_id: tmdbId, media_type: mediaType))
    }
    public func dismiss(tmdbId: Int, mediaType: String) async throws {
        try await send("/api/dismiss", method: "POST", body: IdPayload(tmdb_id: tmdbId, media_type: mediaType))
    }
    public func addToWatchlist(_ card: Card) async throws {
        try await send("/api/watchlist", method: "POST", body: card)
    }
    public func removeFromWatchlist(tmdbId: Int, mediaType: String) async throws {
        try await send("/api/watchlist", method: "DELETE", body: IdPayload(tmdb_id: tmdbId, media_type: mediaType))
    }
    public func saveSettings(_ settings: SettingsPayload) async throws {
        try await send("/api/settings", method: "POST", body: settings)
    }
    public func exchange(code: String) async throws {
        try await send("/auth/exchange", method: "POST", body: ExchangePayload(code: code))
    }
    public func deleteAccount() async throws {
        try await send("/api/me", method: "DELETE")
        // Drop the now-defunct session cookie so the next boot is a fresh anon user.
        clearCookies()
    }
    public func logout() async throws {
        _ = try? await data(for: request("/auth/logout"))
        clearCookies()
    }

    /// The absolute URL to open in the OAuth in-app browser for `provider`.
    public func authStartURL(provider: String) -> URL {
        url("/auth/\(provider)", [URLQueryItem(name: "platform", value: "ios")])
    }

    private func clearCookies() {
        guard let store = session.configuration.httpCookieStorage else { return }
        for c in store.cookies ?? [] where c.name == "rid" { store.deleteCookie(c) }
    }
}

// MARK: - Request bodies

struct IdPayload: Encodable { let tmdb_id: Int; let media_type: String }
struct RatePayload: Encodable { let tmdb_id: Int; let media_type: String; let rating: Double; let title: String?; let year: Int? }
struct ExchangePayload: Encodable { let code: String }

/// `POST /api/settings` body — every field optional so callers send only what
/// changed (country, providers, language, onboarded, watchlistSort).
public struct SettingsPayload: Encodable {
    public var country: String?
    public var providers: [Int]?
    public var language: String?
    public var onboarded: Bool?
    public var watchlistSort: String?
    public init(country: String? = nil, providers: [Int]? = nil, language: String? = nil,
                onboarded: Bool? = nil, watchlistSort: String? = nil) {
        self.country = country; self.providers = providers; self.language = language
        self.onboarded = onboarded; self.watchlistSort = watchlistSort
    }
}

/// Type-erases an `Encodable` so the client can encode heterogeneous bodies.
private struct AnyEncodable: Encodable {
    private let encodeTo: (Encoder) throws -> Void
    init(_ wrapped: Encodable) { encodeTo = wrapped.encode }
    func encode(to encoder: Encoder) throws { try encodeTo(encoder) }
}
