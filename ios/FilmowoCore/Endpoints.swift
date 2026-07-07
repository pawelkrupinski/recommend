import Foundation

/// The Discover filter state, and how it maps to `/api/recommend` query params.
/// Kept in the Foundation-only core so the exact contract (which flags become
/// `=1`, which are omitted) is unit-tested without a network. Mirrors the web
/// app's Discover filter bar and the Android `recommend` call.
public struct RecommendQuery: Equatable {
    public var type: String?     // "movie" | "tv" | nil (all)
    public var genre: String?    // genre name, or nil (all)
    public var tag: String?      // tone slug, or nil (all)
    public var origin: String?   // origin country/continent code, or nil
    public var indie: Bool
    public var excludeUs: Bool
    public var refresh: Bool

    public init(
        type: String? = nil, genre: String? = nil, tag: String? = nil, origin: String? = nil,
        indie: Bool = false, excludeUs: Bool = false, refresh: Bool = false
    ) {
        self.type = type; self.genre = genre; self.tag = tag; self.origin = origin
        self.indie = indie; self.excludeUs = excludeUs; self.refresh = refresh
    }

    /// Query items for `/api/recommend`. Empty strings are treated as "unset"
    /// (so a cleared filter is omitted, not sent blank); booleans appear as `1`
    /// only when true.
    public func queryItems() -> [URLQueryItem] {
        var items: [URLQueryItem] = []
        func add(_ name: String, _ value: String?) {
            guard let v = value?.trimmingCharacters(in: .whitespaces), !v.isEmpty else { return }
            items.append(URLQueryItem(name: name, value: v))
        }
        add("type", type)
        add("genre", genre)
        add("tag", tag)
        add("origin", origin)
        if indie { items.append(URLQueryItem(name: "indie", value: "1")) }
        if excludeUs { items.append(URLQueryItem(name: "excludeUs", value: "1")) }
        if refresh { items.append(URLQueryItem(name: "refresh", value: "1")) }
        return items
    }
}

public enum Endpoints {
    /// The `ids` param for `/api/enrich` — a comma-joined list of
    /// `"media_type:tmdb_id"` keys (e.g. `tv:1399,movie:603`).
    public static func enrichIds(_ cards: [Card]) -> String {
        cards.map(\.key).joined(separator: ",")
    }
}
