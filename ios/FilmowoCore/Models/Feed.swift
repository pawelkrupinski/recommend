import Foundation

/// `/api/recommend` → `{profileSize, results}`. An empty/short `results` during
/// onboarding is what drives the client's "Building your picks…" state.
public struct Recommendations: Codable, Hashable {
    public let profileSize: Int
    public let results: [Card]

    enum CodingKeys: String, CodingKey { case profileSize, results }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        profileSize = try c.decode(Int.self, forKey: .profileSize, default: 0)
        results = try c.decode([Card].self, forKey: .results, default: [])
    }

    public init(profileSize: Int = 0, results: [Card] = []) {
        self.profileSize = profileSize; self.results = results
    }
}

/// `/api/watchlist` → `{watchlist, genres}` (the server also sends `byName`,
/// which we ignore, matching Android).
public struct WatchlistResponse: Codable, Hashable {
    public let watchlist: [Card]
    public let genres: [Genre]

    enum CodingKeys: String, CodingKey { case watchlist, genres }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        watchlist = try c.decode([Card].self, forKey: .watchlist, default: [])
        genres = try c.decode([Genre].self, forKey: .genres, default: [])
    }

    public init(watchlist: [Card] = [], genres: [Genre] = []) {
        self.watchlist = watchlist; self.genres = genres
    }
}

/// `/api/ratings` → `{ratings}`.
public struct RatingsResponse: Codable, Hashable {
    public let ratings: [Rating]

    enum CodingKeys: String, CodingKey { case ratings }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ratings = try c.decode([Rating].self, forKey: .ratings, default: [])
    }

    public init(ratings: [Rating] = []) { self.ratings = ratings }
}

/// One title in the onboarding acclaimed-titles queue (`/api/rate-queue`).
public struct RateQueueItem: Codable, Hashable, Identifiable {
    public let tmdbId: Int
    public let title: String
    public let year: Int?
    public let posterPath: String?
    public let overview: String?
    public let voteAverage: Double?

    public var id: Int { tmdbId }

    enum CodingKeys: String, CodingKey {
        case tmdbId = "tmdb_id"
        case title, year
        case posterPath = "poster_path"
        case overview
        case voteAverage = "vote_average"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tmdbId = try c.decode(Int.self, forKey: .tmdbId, default: 0)
        title = try c.decode(String.self, forKey: .title, default: "")
        year = try c.decodeIfPresent(Int.self, forKey: .year)
        posterPath = try c.decodeIfPresent(String.self, forKey: .posterPath)
        overview = try c.decodeIfPresent(String.self, forKey: .overview)
        voteAverage = try c.decodeIfPresent(Double.self, forKey: .voteAverage)
    }

    public init(
        tmdbId: Int, title: String = "", year: Int? = nil, posterPath: String? = nil,
        overview: String? = nil, voteAverage: Double? = nil
    ) {
        self.tmdbId = tmdbId; self.title = title; self.year = year
        self.posterPath = posterPath; self.overview = overview; self.voteAverage = voteAverage
    }
}

/// `/api/rate-queue?page=N` → `{items, totalPages}`.
public struct RateQueue: Codable, Hashable {
    public let items: [RateQueueItem]
    public let totalPages: Int

    enum CodingKeys: String, CodingKey { case items, totalPages }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = try c.decode([RateQueueItem].self, forKey: .items, default: [])
        totalPages = try c.decode(Int.self, forKey: .totalPages, default: 1)
    }

    public init(items: [RateQueueItem] = [], totalPages: Int = 1) {
        self.items = items; self.totalPages = totalPages
    }
}

/// One line of the `/api/enrich` NDJSON stream: ratings + tones resolved
/// asynchronously for a card, keyed by `"media_type:id"`.
public struct EnrichRow: Codable, Hashable {
    public let key: String
    public let imdbRating: Double?
    public let metascore: Int?
    public let imdbId: String?
    public let tones: [Tone]

    enum CodingKeys: String, CodingKey {
        case key, imdbRating, metascore
        case imdbId = "imdb_id"
        case tones
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decode(String.self, forKey: .key, default: "")
        imdbRating = try c.decodeIfPresent(Double.self, forKey: .imdbRating)
        metascore = try c.decodeIfPresent(Int.self, forKey: .metascore)
        imdbId = try c.decodeIfPresent(String.self, forKey: .imdbId)
        tones = try c.decode([Tone].self, forKey: .tones, default: [])
    }

    public init(
        key: String, imdbRating: Double? = nil, metascore: Int? = nil,
        imdbId: String? = nil, tones: [Tone] = []
    ) {
        self.key = key; self.imdbRating = imdbRating; self.metascore = metascore
        self.imdbId = imdbId; self.tones = tones
    }
}
