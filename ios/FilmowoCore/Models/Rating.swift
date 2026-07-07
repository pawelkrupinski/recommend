import Foundation

/// A user's rating of a title. Mirrors Android `Rating` and the `ratings` DB row.
/// Encodes back to the `POST /api/ratings` body shape (`tmdb_id`, `media_type`,
/// `rating`, `title`, `year`).
public struct Rating: Codable, Hashable, Identifiable {
    public let tmdbId: Int
    public let mediaType: String
    public let rating: Double
    public let title: String?
    public let year: Int?
    public let source: String?
    public let ratedAt: String?

    public var key: String { "\(mediaType):\(tmdbId)" }
    public var id: String { key }

    enum CodingKeys: String, CodingKey {
        case tmdbId = "tmdb_id"
        case mediaType = "media_type"
        case rating, title, year, source
        case ratedAt = "rated_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tmdbId = try c.decode(Int.self, forKey: .tmdbId, default: 0)
        mediaType = try c.decode(String.self, forKey: .mediaType, default: "movie")
        rating = try c.decode(Double.self, forKey: .rating, default: 0)
        title = try c.decodeIfPresent(String.self, forKey: .title)
        year = try c.decodeIfPresent(Int.self, forKey: .year)
        source = try c.decodeIfPresent(String.self, forKey: .source)
        ratedAt = try c.decodeIfPresent(String.self, forKey: .ratedAt)
    }

    public init(
        tmdbId: Int, mediaType: String = "movie", rating: Double, title: String? = nil,
        year: Int? = nil, source: String? = nil, ratedAt: String? = nil
    ) {
        self.tmdbId = tmdbId; self.mediaType = mediaType; self.rating = rating
        self.title = title; self.year = year; self.source = source; self.ratedAt = ratedAt
    }
}
