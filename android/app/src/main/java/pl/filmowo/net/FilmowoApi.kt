package pl.filmowo.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import pl.filmowo.model.EnrichRow
import pl.filmowo.model.GenresResponse
import pl.filmowo.model.Me
import pl.filmowo.model.OriginsResponse
import pl.filmowo.model.Pick
import pl.filmowo.model.ProvidersResponse
import pl.filmowo.model.RateQueue
import pl.filmowo.model.RatingsResponse
import pl.filmowo.model.Recommendations
import pl.filmowo.model.SearchResponse
import pl.filmowo.model.TonesResponse
import pl.filmowo.model.WatchlistResponse
import pl.filmowo.model.WhereInfo

/**
 * The recommend server's JSON API over a shared OkHttp client. Raw OkHttp +
 * kotlinx.serialization (no Retrofit), the movies app's convention. The session
 * `rid` cookie is carried automatically by the client's [PersistentCookieJar];
 * every call runs on [Dispatchers.IO].
 *
 * `baseUrl` defaults to the app's BuildConfig value in production and is injected
 * (a MockWebServer URL) in tests.
 */
class FilmowoApi(
    private val client: OkHttpClient,
    private val baseUrl: String,
) {
    // coerceInputValues: an explicit `null` from the server on a non-null field
    // that has a default falls back to that default instead of throwing (which
    // would abort the whole response parse and silently strand the UI). Belt and
    // braces alongside the wire types' own nullability.
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = false; coerceInputValues = true }

    // ---- reads ----
    suspend fun me(): Me = get("/api/me", serializer = Me.serializer())

    /** Conditional fetch of the picks: send the cached [etag] as `If-None-Match` so
     *  an unchanged build comes back as a 304 ([Conditional.notModified]) and the
     *  client keeps its local copy instead of re-shipping the whole screenful. */
    suspend fun recommend(params: Map<String, String>, etag: String? = null): Conditional<Recommendations> =
        conditionalGet("/api/recommend", params, etag, Recommendations.serializer())

    /** Free-text title search across the user's chosen services (server-sorted
     *  on-service-first). Same rich [Pick] cards as Discover. */
    suspend fun search(q: String): List<Pick> =
        get("/api/search", mapOf("q" to q), SearchResponse.serializer()).results

    suspend fun watchlist(): WatchlistResponse = get("/api/watchlist", serializer = WatchlistResponse.serializer())

    suspend fun ratings(): RatingsResponse = get("/api/ratings", serializer = RatingsResponse.serializer())

    suspend fun genres(): GenresResponse = get("/api/genres", serializer = GenresResponse.serializer())

    suspend fun tones(): TonesResponse = get("/api/tones", serializer = TonesResponse.serializer())

    suspend fun providers(region: String): ProvidersResponse =
        get("/api/providers", mapOf("region" to region), ProvidersResponse.serializer())

    suspend fun origins(): OriginsResponse = get("/api/origins", serializer = OriginsResponse.serializer())

    /** Reverse-geocode a GPS position to an ISO country via the server, or null. */
    suspend fun geocode(lat: Double, lng: Double): String? =
        get("/api/geocode", mapOf("lat" to lat.toString(), "lng" to lng.toString()), GeocodeResponse.serializer()).country

    suspend fun rateQueue(page: Int): RateQueue =
        get("/api/rate-queue", mapOf("page" to page.toString()), RateQueue.serializer())

    suspend fun where(tmdbId: Int, mediaType: String, region: String?, serviceIds: List<Int>): WhereInfo {
        val params = buildMap {
            put("id", tmdbId.toString())
            put("media_type", mediaType)
            if (!region.isNullOrBlank()) put("region", region)
            if (serviceIds.isNotEmpty()) put("sv", serviceIds.sorted().joinToString("."))
        }
        return get("/api/where", params, WhereInfo.serializer())
    }

    /** /api/enrich streams NDJSON — one [EnrichRow] per line. */
    suspend fun enrich(ids: List<String>): List<EnrichRow> = withContext(Dispatchers.IO) {
        if (ids.isEmpty()) return@withContext emptyList()
        val req = Request.Builder().url(urlFor("/api/enrich", mapOf("ids" to ids.joinToString(",")))).header("User-Agent", UA).build()
        client.newCall(req).execute().use { res ->
            res.body.string().lineSequence().filter { it.isNotBlank() }
                .map { json.decodeFromString(EnrichRow.serializer(), it) }
                .toList()
        }
    }

    // ---- writes ----
    suspend fun rate(tmdbId: Int, mediaType: String, rating: Int, title: String?, year: Int?) =
        send("/api/ratings", "POST", json.encodeToString(RatePayload(tmdbId, mediaType, rating, title, year)))

    suspend fun deleteRating(tmdbId: Int, mediaType: String) =
        send("/api/ratings", "DELETE", json.encodeToString(IdPayload(tmdbId, mediaType)))

    suspend fun dismiss(tmdbId: Int, mediaType: String) =
        send("/api/dismiss", "POST", json.encodeToString(IdPayload(tmdbId, mediaType)))

    suspend fun notSeen(tmdbId: Int, mediaType: String) =
        send("/api/not-seen", "POST", json.encodeToString(IdPayload(tmdbId, mediaType)))

    suspend fun saveToWatchlist(pick: Pick) =
        send("/api/watchlist", "POST", json.encodeToString(Pick.serializer(), pick))

    suspend fun removeFromWatchlist(tmdbId: Int, mediaType: String) =
        send("/api/watchlist", "DELETE", json.encodeToString(IdPayload(tmdbId, mediaType)))

    suspend fun saveSettings(settings: SettingsPayload) =
        send("/api/settings", "POST", json.encodeToString(settings))

    // ---- plumbing ----
    private suspend fun <T> get(path: String, params: Map<String, String> = emptyMap(), serializer: KSerializer<T>): T =
        withContext(Dispatchers.IO) {
            val req = Request.Builder().url(urlFor(path, params)).header("User-Agent", UA).build()
            client.newCall(req).execute().use { res ->
                val body = res.body.string()
                if (!res.isSuccessful) throw ApiException(res.code, body)
                json.decodeFromString(serializer, body)
            }
        }

    // A conditional GET: send If-None-Match and surface a 304 as `notModified`
    // (kept distinct from a hard failure) plus the fresh ETag on a 200 so the
    // caller can cache it for next time. 304 isn't "successful" to OkHttp, so it's
    // handled before the non-2xx throw.
    private suspend fun <T> conditionalGet(
        path: String, params: Map<String, String>, etag: String?, serializer: KSerializer<T>,
    ): Conditional<T> = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(urlFor(path, params)).header("User-Agent", UA)
            .apply { if (!etag.isNullOrBlank()) header("If-None-Match", etag) }
            .build()
        client.newCall(req).execute().use { res ->
            if (res.code == 304) return@withContext Conditional<T>(null, etag, notModified = true)
            val body = res.body.string()
            if (!res.isSuccessful) throw ApiException(res.code, body)
            Conditional(json.decodeFromString(serializer, body), res.header("ETag"), notModified = false)
        }
    }

    private suspend fun send(path: String, method: String, body: String) = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(urlFor(path)).header("User-Agent", UA)
            .method(method, body.toRequestBody(JSON_MEDIA)).build()
        client.newCall(req).execute().use { res ->
            if (!res.isSuccessful) throw ApiException(res.code, res.body.string())
        }
    }

    private fun urlFor(path: String, params: Map<String, String> = emptyMap()): HttpUrl {
        val b = (baseUrl.trimEnd('/') + path).toHttpUrl().newBuilder()
        for ((k, v) in params) b.addQueryParameter(k, v)
        return b.build()
    }

    @Serializable
    private data class RatePayload(
        @SerialName("tmdb_id") val tmdbId: Int,
        @SerialName("media_type") val mediaType: String,
        val rating: Int,
        val title: String?,
        val year: Int?,
    )

    @Serializable
    private data class GeocodeResponse(val country: String? = null)

    @Serializable
    private data class IdPayload(
        @SerialName("tmdb_id") val tmdbId: Int,
        @SerialName("media_type") val mediaType: String,
    )

    private companion object {
        const val UA = "FilmowoAndroid/1.0"
        val JSON_MEDIA = "application/json".toMediaType()
    }
}

/** Fields the Settings screen can push; nulls are omitted (encodeDefaults = false). */
@Serializable
data class SettingsPayload(
    val country: String? = null,
    val providers: List<Int>? = null,
    val language: String? = null,
    val onboarded: Boolean? = null,
)

class ApiException(val code: Int, val bodyText: String) : Exception("HTTP $code: $bodyText")

/** The outcome of a conditional GET: [value] + its [etag] on a 200, or
 *  [notModified] with a null value on a 304 (the caller keeps its cached copy). */
data class Conditional<T>(val value: T?, val etag: String?, val notModified: Boolean)
