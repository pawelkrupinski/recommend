import Foundation

/// A streaming service (TMDB "watch provider").
public struct Service: Codable, Hashable, Identifiable {
    public let id: Int
    public let name: String
    public let logo: String?

    public init(id: Int, name: String, logo: String? = nil) {
        self.id = id; self.name = name; self.logo = logo
    }
}

/// A mood/tone tag (`{slug, label}`), from the tones crosswalk.
public struct Tone: Codable, Hashable, Identifiable {
    public let slug: String
    public let label: String
    public var id: String { slug }

    public init(slug: String, label: String) { self.slug = slug; self.label = label }
}

/// A YouTube trailer reference.
public struct Trailer: Codable, Hashable {
    public let key: String
    public let name: String?

    public init(key: String, name: String? = nil) { self.key = key; self.name = name }
}

/// A genre `{id, name}`.
public struct Genre: Codable, Hashable, Identifiable {
    public let id: Int
    public let name: String

    public init(id: Int, name: String) { self.id = id; self.name = name }
}

/// A recommendation card — the central domain object, served by `/api/recommend`
/// and `/api/watchlist`, and sent back verbatim as the `POST /api/watchlist`
/// body. Mirrors Android `Pick` (`model/Models.kt`). The stable identity across
/// the app is ``key`` = `"media_type:tmdb_id"`, since a film and a series can
/// share a TMDB id.
public struct Card: Codable, Hashable, Identifiable {
    public let tmdbId: Int
    public let mediaType: String
    public let imdbId: String?
    public let title: String
    public let year: Int?
    public let runtime: Int?
    public let seasons: Int?
    public let episodes: Int?
    public let overview: String?
    public let posterPath: String?
    public let voteAverage: Double?
    public let imdbRating: Double?
    public let imdbVotes: Int?
    public let metascore: Int?
    public let genres: [String]
    public let genreIds: [Int]
    public let tones: [Tone]
    public let director: String?
    public let cast: [String]
    public let trailers: [Trailer]
    public let services: [Service]
    public let score: Double?

    /// `"movie:603"` — stable identity used as the SwiftUI `id` and the map key
    /// for ratings/watchlist membership.
    public var key: String { "\(mediaType):\(tmdbId)" }
    public var id: String { key }

    enum CodingKeys: String, CodingKey {
        case tmdbId = "tmdb_id"
        case mediaType = "media_type"
        case imdbId = "imdb_id"
        case title, year, runtime, seasons, episodes, overview
        case posterPath = "poster_path"
        case voteAverage = "vote_average"
        case imdbRating, imdbVotes, metascore
        case genres
        case genreIds = "genreIds"
        case tones, director, cast, trailers, services, score
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tmdbId = try c.decode(Int.self, forKey: .tmdbId, default: 0)
        mediaType = try c.decode(String.self, forKey: .mediaType, default: "movie")
        imdbId = try c.decodeIfPresent(String.self, forKey: .imdbId)
        title = try c.decode(String.self, forKey: .title, default: "")
        year = try c.decodeIfPresent(Int.self, forKey: .year)
        runtime = try c.decodeIfPresent(Int.self, forKey: .runtime)
        seasons = try c.decodeIfPresent(Int.self, forKey: .seasons)
        episodes = try c.decodeIfPresent(Int.self, forKey: .episodes)
        overview = try c.decodeIfPresent(String.self, forKey: .overview)
        posterPath = try c.decodeIfPresent(String.self, forKey: .posterPath)
        voteAverage = try c.decodeIfPresent(Double.self, forKey: .voteAverage)
        imdbRating = try c.decodeIfPresent(Double.self, forKey: .imdbRating)
        imdbVotes = try c.decodeIfPresent(Int.self, forKey: .imdbVotes)
        metascore = try c.decodeIfPresent(Int.self, forKey: .metascore)
        genres = try c.decode([String].self, forKey: .genres, default: [])
        genreIds = try c.decode([Int].self, forKey: .genreIds, default: [])
        tones = try c.decode([Tone].self, forKey: .tones, default: [])
        director = try c.decodeIfPresent(String.self, forKey: .director)
        cast = try c.decode([String].self, forKey: .cast, default: [])
        trailers = try c.decode([Trailer].self, forKey: .trailers, default: [])
        services = try c.decode([Service].self, forKey: .services, default: [])
        score = try c.decodeIfPresent(Double.self, forKey: .score)
    }

    public init(
        tmdbId: Int, mediaType: String = "movie", imdbId: String? = nil, title: String = "",
        year: Int? = nil, runtime: Int? = nil, seasons: Int? = nil, episodes: Int? = nil,
        overview: String? = nil, posterPath: String? = nil, voteAverage: Double? = nil,
        imdbRating: Double? = nil, imdbVotes: Int? = nil, metascore: Int? = nil,
        genres: [String] = [], genreIds: [Int] = [], tones: [Tone] = [], director: String? = nil,
        cast: [String] = [], trailers: [Trailer] = [], services: [Service] = [], score: Double? = nil
    ) {
        self.tmdbId = tmdbId; self.mediaType = mediaType; self.imdbId = imdbId; self.title = title
        self.year = year; self.runtime = runtime; self.seasons = seasons; self.episodes = episodes
        self.overview = overview; self.posterPath = posterPath; self.voteAverage = voteAverage
        self.imdbRating = imdbRating; self.imdbVotes = imdbVotes; self.metascore = metascore
        self.genres = genres; self.genreIds = genreIds; self.tones = tones; self.director = director
        self.cast = cast; self.trailers = trailers; self.services = services; self.score = score
    }
}
