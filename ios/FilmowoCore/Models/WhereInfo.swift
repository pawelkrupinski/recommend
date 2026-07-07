import Foundation

/// A "watch now" deep link into a streaming app for a given region.
public struct DeepLink: Codable, Hashable, Identifiable {
    public let service: String
    public let type: String?
    public let link: String
    public let providerId: Int?

    public var id: String { "\(service)-\(providerId ?? 0)-\(link)" }

    public init(service: String, type: String? = nil, link: String, providerId: Int? = nil) {
        self.service = service; self.type = type; self.link = link; self.providerId = providerId
    }
}

/// A flat-rate (subscription) service offering, `{name, logo}`.
public struct Flatrate: Codable, Hashable, Identifiable {
    public let name: String
    public let logo: String?
    public var id: String { name }

    public init(name: String, logo: String? = nil) { self.name = name; self.logo = logo }
}

/// Where-to-watch info for a title in a region, from `/api/where`. Mirrors
/// Android `WhereInfo`: subscription services, per-service deep links, the TMDB
/// link, and a `credits` map (e.g. director/cast display strings).
public struct WhereInfo: Codable, Hashable {
    public let region: String?
    public let tmdbLink: String?
    public let flatrate: [Flatrate]
    public let deepLinks: [DeepLink]
    public let credits: [String: String]

    enum CodingKeys: String, CodingKey {
        case region, tmdbLink, flatrate, deepLinks, credits
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        region = try c.decodeIfPresent(String.self, forKey: .region)
        tmdbLink = try c.decodeIfPresent(String.self, forKey: .tmdbLink)
        flatrate = try c.decode([Flatrate].self, forKey: .flatrate, default: [])
        deepLinks = try c.decode([DeepLink].self, forKey: .deepLinks, default: [])
        credits = try c.decode([String: String].self, forKey: .credits, default: [:])
    }

    public init(
        region: String? = nil, tmdbLink: String? = nil, flatrate: [Flatrate] = [],
        deepLinks: [DeepLink] = [], credits: [String: String] = [:]
    ) {
        self.region = region; self.tmdbLink = tmdbLink; self.flatrate = flatrate
        self.deepLinks = deepLinks; self.credits = credits
    }
}
