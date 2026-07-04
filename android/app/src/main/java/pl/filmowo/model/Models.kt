package pl.filmowo.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// Wire types for the recommend server's JSON API. Field names track the server's
// mixed snake_case/camelCase keys via @SerialName; Json is parsed with
// ignoreUnknownKeys so extra server fields never break the client.

@Serializable
data class Me(
    val user: MeUser? = null,
    val anonymous: Boolean = true,
    val onboarded: Boolean = false,
    val providers: List<String> = emptyList(),
    val services: List<Int> = emptyList(),
    val country: String = "PL",
    val language: String = "en",
    val watchlistSort: String = "added",
    val detectedCountry: String? = null,
    val detectedLanguage: String? = null,
)

@Serializable
data class MeUser(
    val email: String? = null,
    val name: String? = null,
    val picture: String? = null,
)

@Serializable
data class Tone(val slug: String, val label: String)

@Serializable
data class Genre(val id: Int, val name: String)

@Serializable
data class Trailer(val key: String, val name: String? = null)

@Serializable
data class Service(val id: Int, val name: String, val logo: String? = null)

/** A recommendation card / watchlist item — the rich "pick" object. */
@Serializable
data class Pick(
    @SerialName("tmdb_id") val tmdbId: Int,
    @SerialName("media_type") val mediaType: String = "movie",
    @SerialName("imdb_id") val imdbId: String? = null,
    val title: String = "",
    val year: Int? = null,
    val runtime: Int? = null,
    val seasons: Int? = null,
    val episodes: Int? = null,
    val overview: String? = null,
    @SerialName("poster_path") val posterPath: String? = null,
    @SerialName("vote_average") val voteAverage: Double? = null,
    val imdbRating: Double? = null,
    val imdbVotes: Int? = null,
    val metascore: Int? = null,
    val genres: List<String> = emptyList(),
    val genreIds: List<Int> = emptyList(),
    val tones: List<Tone> = emptyList(),
    val director: String? = null,
    val cast: List<String> = emptyList(),
    val trailers: List<Trailer> = emptyList(),
    val services: List<Service> = emptyList(),
    val score: Double? = null,
) {
    /** Stable identity across the app (tmdb id + media type), matching the web pickKey. */
    val key: String get() = "$mediaType:$tmdbId"
}

@Serializable
data class Recommendations(val profileSize: Int = 0, val results: List<Pick> = emptyList())

@Serializable
data class WatchlistResponse(
    val watchlist: List<Pick> = emptyList(),
    val genres: List<Genre> = emptyList(),
)

@Serializable
data class Rating(
    @SerialName("tmdb_id") val tmdbId: Int,
    @SerialName("media_type") val mediaType: String = "movie",
    val rating: Double,
    val title: String? = null,
    val year: Int? = null,
    val source: String? = null,
    @SerialName("rated_at") val ratedAt: String? = null,
)

@Serializable
data class RatingsResponse(val ratings: List<Rating> = emptyList())

@Serializable
data class GenresResponse(val genres: List<Genre> = emptyList())

@Serializable
data class TonesResponse(val tones: List<Tone> = emptyList())

@Serializable
data class Continent(
    val code: String,
    val name: String,
    val countries: List<List<String>> = emptyList(), // [[code, name], ...]
)

@Serializable
data class OriginsResponse(val continents: List<Continent> = emptyList())

@Serializable
data class ProvidersResponse(val providers: List<Service> = emptyList(), val source: String? = null)

@Serializable
data class DeepLink(
    val service: String,
    val type: String? = null,
    val link: String,
    val providerId: Int? = null,
)

@Serializable
data class Flatrate(val name: String, val logo: String? = null)

@Serializable
data class WhereInfo(
    val region: String? = null,
    val tmdbLink: String? = null,
    val flatrate: List<Flatrate> = emptyList(),
    val deepLinks: List<DeepLink> = emptyList(),
    val credits: Map<String, String> = emptyMap(),
)

@Serializable
data class RateQueueItem(
    @SerialName("tmdb_id") val tmdbId: Int,
    val title: String = "",
    val year: Int? = null,
    @SerialName("poster_path") val posterPath: String? = null,
    val overview: String? = null,
    @SerialName("vote_average") val voteAverage: Double? = null,
)

@Serializable
data class RateQueue(val items: List<RateQueueItem> = emptyList(), val totalPages: Int = 1)

/** One NDJSON row from /api/enrich, patching a card's badges after first paint. */
@Serializable
data class EnrichRow(
    val key: String,
    val imdbRating: Double? = null,
    val metascore: Int? = null,
    @SerialName("imdb_id") val imdbId: String? = null,
    val tones: List<Tone> = emptyList(),
)
