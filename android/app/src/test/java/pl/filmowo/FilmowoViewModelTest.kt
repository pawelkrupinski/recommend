package pl.filmowo

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import pl.filmowo.auth.SessionAuth
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import pl.filmowo.data.AppPreferences
import pl.filmowo.data.CachedDiscover
import pl.filmowo.data.DiscoverCache
import pl.filmowo.location.RegionSource
import pl.filmowo.model.Pick
import pl.filmowo.net.FilmowoApi
import pl.filmowo.ui.DiscoverMode
import pl.filmowo.ui.FilmowoViewModel
import pl.filmowo.ui.LOAD_ERROR

/**
 * The view model against the real [FilmowoApi] over a path-matching MockWebServer
 * (the network boundary is the seam), with boring fakes for the Context-bound
 * auth + prefs collaborators. Proves the adaptive Discover decision, badge
 * enrichment, and optimistic rating.
 */
class FilmowoViewModelTest {
    private lateinit var server: MockWebServer

    private val me = """{"user":{"email":"a@b.com"},"anonymous":false,"onboarded":true,
        "providers":["google"],"services":[8],"country":"US","language":"en"}"""

    @Before
    fun setUp() {
        @Suppress("EXPERIMENTAL_API_USAGE")
        Dispatchers.setMain(Dispatchers.Unconfined)
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        server.shutdown()
    }

    private fun serve(routes: Map<String, String>) {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path.orEmpty().substringBefore('?')
                val body = routes[path] ?: "{}"
                return MockResponse().setBody(body)
            }
        }
    }

    private fun viewModel(
        prefs: FakePrefs = FakePrefs(),
        cache: DiscoverCache = FakeDiscoverCache(),
    ): FilmowoViewModel {
        val api = FilmowoApi(OkHttpClient(), server.url("/").toString())
        return FilmowoViewModel(api, FakeAuth(), prefs, cache, FakeRegion())
    }

    private fun <T> await(flow: StateFlow<T>, timeoutMs: Long = 5_000, predicate: (T) -> Boolean): T = runBlocking {
        val start = System.currentTimeMillis()
        while (!predicate(flow.value)) {
            if (System.currentTimeMillis() - start > timeoutMs) fail("timed out; last value = ${flow.value}")
            delay(15)
        }
        flow.value
    }

    // The prod /api/me body: the app hits filmowo.fly.dev directly (no Cloudflare
    // CF-IPCountry header), so the server can't detect a country and sends null.
    private val meNullCountry = """{"user":{"id":41,"email":null,"name":null,"picture":null},
        "anonymous":true,"onboarded":false,"providers":["google","facebook"],"services":[],
        "country":null,"language":"en","watchlistSort":"added","detectedCountry":null,
        "detectedLanguage":"en"}"""

    @Test
    fun `me with a null country still parses so the spinner clears`() {
        // Regression: `country` was a non-null String, and kotlinx throws on an
        // explicit null there even with a default — /api/me failed to parse, `me`
        // stayed null, and the app hung on its loading spinner forever.
        serve(mapOf("/api/me" to meNullCountry))
        val vm = viewModel()
        val me = await(vm.me) { it != null }!!
        assertEquals(null, me.country)
        assertTrue(me.anonymous)
        assertEquals(false, me.onboarded)
    }

    @Test
    fun `few ratings put Discover into onboarding with a rate queue`() {
        serve(
            mapOf(
                "/api/me" to me,
                "/api/genres" to """{"genres":[]}""",
                "/api/tones" to """{"tones":[]}""",
                "/api/ratings" to """{"ratings":[{"tmdb_id":1,"rating":8}]}""", // 1 < goal(10)
                "/api/rate-queue" to """{"items":[{"tmdb_id":50,"title":"Stalker","year":1979}],"totalPages":3}""",
                "/api/watchlist" to """{"watchlist":[]}""",
            ),
        )
        val vm = viewModel()
        val state = await(vm.discover) { it.mode == DiscoverMode.ONBOARDING }
        assertEquals(1, state.ratedCount)
        assertEquals("Stalker", state.queue.first().title)
    }

    @Test
    fun `enough ratings put Discover into picks and enrich fills badges`() {
        val ratings = (1..10).joinToString(",") { """{"tmdb_id":$it,"rating":7}""" }
        serve(
            mapOf(
                "/api/me" to me,
                "/api/genres" to """{"genres":[]}""",
                "/api/tones" to """{"tones":[]}""",
                "/api/ratings" to """{"ratings":[$ratings]}""", // 10 == goal
                "/api/recommend" to """{"profileSize":10,"results":[{"tmdb_id":99,"media_type":"movie","title":"Solaris"}]}""",
                "/api/enrich" to "{\"key\":\"movie:99\",\"imdbRating\":8.1,\"metascore\":83}\n",
                "/api/watchlist" to """{"watchlist":[]}""",
            ),
        )
        val vm = viewModel()
        val picks = await(vm.discover) { it.mode == DiscoverMode.PICKS && it.picks.isNotEmpty() }
        assertEquals("Solaris", picks.picks.first().title)

        // Enrichment streams in after first paint and patches the badges.
        val enriched = await(vm.discover) { it.picks.firstOrNull()?.imdbRating != null }
        assertEquals(8.1, enriched.picks.first().imdbRating!!, 1e-6)
        assertEquals(83, enriched.picks.first().metascore)
    }

    @Test
    fun `rating a pick optimistically removes it from the grid`() {
        serve(
            mapOf(
                "/api/me" to me,
                "/api/genres" to """{"genres":[]}""",
                "/api/tones" to """{"tones":[]}""",
                "/api/ratings" to """{"ratings":[${(1..10).joinToString(",") { "{\"tmdb_id\":$it,\"rating\":7}" }}]}""",
                "/api/recommend" to """{"profileSize":10,"results":[
                    {"tmdb_id":99,"media_type":"movie","title":"Solaris"},
                    {"tmdb_id":100,"media_type":"movie","title":"Stalker"}]}""",
                "/api/enrich" to "\n",
                "/api/watchlist" to """{"watchlist":[]}""",
            ),
        )
        val vm = viewModel()
        val loaded = await(vm.discover) { it.mode == DiscoverMode.PICKS && it.picks.size == 2 }
        vm.ratePick(loaded.picks.first(), 9)
        val after = await(vm.discover) { it.picks.size == 1 }
        assertTrue(after.picks.none { it.tmdbId == 99 })
        assertNotNull(after.picks.firstOrNull { it.tmdbId == 100 })
    }

    @Test
    fun `search fetches matches after the debounce and populates results`() {
        serve(
            mapOf(
                "/api/me" to me,
                "/api/ratings" to """{"ratings":[]}""",
                "/api/watchlist" to """{"watchlist":[]}""",
                "/api/rate-queue" to """{"items":[],"totalPages":1}""",
                "/api/search" to """{"results":[{"tmdb_id":7,"media_type":"movie","title":"Solaris","services":[]}]}""",
            ),
        )
        val vm = viewModel()
        await(vm.me) { it != null }
        vm.search("solaris")
        val s = await(vm.search) { it.results.isNotEmpty() }
        assertEquals("Solaris", s.results.first().title)
        assertEquals("solaris", s.query)
        assertFalse(s.loading)
    }

    @Test
    fun `rating a search result optimistically removes it from the results grid`() {
        serve(
            mapOf(
                "/api/me" to me,
                "/api/ratings" to """{"ratings":[]}""",
                "/api/watchlist" to """{"watchlist":[]}""",
                "/api/rate-queue" to """{"items":[],"totalPages":1}""",
                "/api/search" to """{"results":[
                    {"tmdb_id":7,"media_type":"movie","title":"Solaris"},
                    {"tmdb_id":8,"media_type":"movie","title":"Stalker"}]}""",
            ),
        )
        val vm = viewModel()
        await(vm.me) { it != null }
        vm.search("s")
        val loaded = await(vm.search) { it.results.size == 2 }
        vm.ratePick(loaded.results.first(), 9)
        val after = await(vm.search) { it.results.size == 1 }
        assertTrue(after.results.none { it.tmdbId == 7 })
        assertNotNull(after.results.firstOrNull { it.tmdbId == 8 })
    }

    @Test
    fun `a blank search query clears the results without a fetch`() {
        val requests = java.util.Collections.synchronizedList(mutableListOf<String>())
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path.orEmpty().substringBefore('?')
                requests.add(path)
                val body = when (path) {
                    "/api/me" -> me
                    "/api/search" -> """{"results":[{"tmdb_id":7,"media_type":"movie","title":"Solaris"}]}"""
                    else -> "{}"
                }
                return MockResponse().setBody(body)
            }
        }
        val vm = viewModel()
        await(vm.me) { it != null }
        vm.search("solaris")
        await(vm.search) { it.results.isNotEmpty() }
        vm.search("")
        val cleared = await(vm.search) { it.results.isEmpty() && it.query.isEmpty() }
        assertTrue(cleared.results.isEmpty())
        // Clearing the box must not fire another /api/search.
        val searchesAfterClear = runBlocking {
            delay(350) // longer than the debounce window
            synchronized(requests) { requests.count { it == "/api/search" } }
        }
        assertEquals(1, searchesAfterClear)
    }

    @Test
    fun `removing a watchlist item re-syncs from the server`() {
        val requests = java.util.Collections.synchronizedList(mutableListOf<String>())
        var removed = false
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path.orEmpty().substringBefore('?')
                requests.add("${request.method} $path")
                val body = when (path) {
                    "/api/me" -> me
                    "/api/watchlist" -> {
                        if (request.method == "DELETE") removed = true
                        if (removed) """{"watchlist":[]}""" else """{"watchlist":[{"tmdb_id":7,"media_type":"movie","title":"Amelie"}]}"""
                    }
                    "/api/ratings" -> """{"ratings":[${(1..10).joinToString(",") { "{\"tmdb_id\":$it,\"rating\":7}" }}]}"""
                    "/api/recommend" -> """{"profileSize":10,"results":[]}"""
                    else -> "{}"
                }
                return MockResponse().setBody(body)
            }
        }
        val vm = viewModel()
        val loaded = await(vm.watchlist) { it.items.size == 1 }
        vm.removeFromWatchlist(loaded.items.first())

        // The optimistic removal clears the list immediately, so poll the request
        // log for proof the mutation hit the server AND a fresh GET followed it to
        // re-sync (both run on IO threads behind the optimistic update).
        val synced = runBlocking {
            val start = System.currentTimeMillis()
            while (System.currentTimeMillis() - start < 5_000) {
                val snap = synchronized(requests) { requests.toList() }
                val delete = snap.indexOfLast { it == "DELETE /api/watchlist" }
                val getAfter = snap.withIndex().firstOrNull { (i, r) -> i > delete && r == "GET /api/watchlist" }?.index ?: -1
                if (delete >= 0 && getAfter > delete) return@runBlocking true
                delay(15)
            }
            false
        }
        assertTrue("expected DELETE then GET on /api/watchlist; saw $requests", synced)
    }

    @Test
    fun `a failed boot probe surfaces an error and retry recovers`() {
        // First /api/me fails (server unreachable): the app must show a boot error,
        // not hang on the spinner. Then the server recovers and retry loads it.
        var meFails = true
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path.orEmpty().substringBefore('?')
                if (path == "/api/me" && meFails) return MockResponse().setResponseCode(503)
                val body = when (path) {
                    "/api/me" -> me
                    "/api/ratings" -> """{"ratings":[]}"""
                    "/api/rate-queue" -> """{"items":[{"tmdb_id":1,"title":"X"}],"totalPages":1}"""
                    "/api/watchlist" -> """{"watchlist":[]}"""
                    else -> "{}"
                }
                return MockResponse().setBody(body)
            }
        }
        val vm = viewModel()
        await(vm.bootFailed) { it }
        assertNull(vm.me.value)
        // The exact failure reason is captured so the error screen is self-diagnosing.
        val reason = await(vm.bootError) { it != null }!!
        assertTrue("expected the exception detail, got '$reason'", reason.contains("ApiException"))

        meFails = false
        vm.refreshAll()
        await(vm.me) { it != null }
        assertFalse(vm.bootFailed.value)
        assertNull("a recovered boot clears the error detail", vm.bootError.value)
    }

    @Test
    fun `a discover load failure surfaces an error state, not a stuck spinner`() {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path.orEmpty().substringBefore('?')
                if (path == "/api/ratings") return MockResponse().setResponseCode(500)
                val body = when (path) {
                    "/api/me" -> me
                    "/api/watchlist" -> """{"watchlist":[]}"""
                    else -> "{}"
                }
                return MockResponse().setBody(body)
            }
        }
        val vm = viewModel()
        val d = await(vm.discover) { it.error != null }
        assertEquals(LOAD_ERROR, d.error)
        assertFalse("must not stay stuck in the loading state", d.loading)
    }

    @Test
    fun `switching type narrows the loaded picks instantly, then the server refetch fills in`() {
        val requests = java.util.Collections.synchronizedList(mutableListOf<String>())
        val tenRatings = (1..10).joinToString(",") { "{\"tmdb_id\":$it,\"rating\":7}" }
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val full = request.path.orEmpty()
                requests.add("${request.method} $full")
                val path = full.substringBefore('?')
                return when {
                    path == "/api/me" -> MockResponse().setBody(me)
                    path == "/api/ratings" -> MockResponse().setBody("""{"ratings":[$tenRatings]}""")
                    path == "/api/watchlist" -> MockResponse().setBody("""{"watchlist":[]}""")
                    path == "/api/enrich" -> MockResponse().setBody("\n")
                    path == "/api/recommend" && full.contains("type=movie") ->
                        // A DIFFERENT movie than the loaded ones, delayed so the
                        // instant (optimistic) state is observable before it lands.
                        MockResponse().setBody("""{"profileSize":10,"results":[{"tmdb_id":200,"media_type":"movie","title":"Fresh"}]}""")
                            .setBodyDelay(300, java.util.concurrent.TimeUnit.MILLISECONDS)
                    path == "/api/recommend" ->
                        MockResponse().setBody("""{"profileSize":10,"results":[
                            {"tmdb_id":99,"media_type":"movie","title":"M"},
                            {"tmdb_id":100,"media_type":"tv","title":"T"}]}""")
                    else -> MockResponse().setBody("{}")
                }
            }
        }
        val vm = viewModel()
        await(vm.discover) { it.mode == DiscoverMode.PICKS && it.picks.size == 2 }
        val ratingsCallsBefore = synchronized(requests) { requests.count { it == "GET /api/ratings" } }

        vm.setType("movie")

        // Instant: only the movie among the already-loaded picks (id 99) shows,
        // before the delayed type=movie refetch returns.
        val instant = await(vm.discover) { it.picks.size == 1 && it.picks.first().tmdbId == 99 }
        assertEquals("movie", instant.type)

        // Then the server's fuller type-scoped set (id 200) replaces it.
        await(vm.discover) { it.picks.any { p -> p.tmdbId == 200 } }

        // The filter change reused the known rate count — no extra /api/ratings call.
        val ratingsCallsAfter = synchronized(requests) { requests.count { it == "GET /api/ratings" } }
        assertEquals(ratingsCallsBefore, ratingsCallsAfter)
    }

    @Test
    fun `the watchlist sort is restored from local prefs on launch`() {
        serve(
            mapOf(
                "/api/me" to me,
                "/api/ratings" to """{"ratings":[]}""",
                "/api/watchlist" to """{"watchlist":[]}""",
                "/api/rate-queue" to """{"items":[],"totalPages":1}""",
            ),
        )
        val vm = viewModel(FakePrefs(initialSort = "rating"))
        val state = await(vm.watchlist) { it.sort == "rating" }
        assertEquals("rating", state.sort)
    }

    @Test
    fun `setting the watchlist sort saves it locally and never syncs to the server`() {
        val requests = java.util.Collections.synchronizedList(mutableListOf<String>())
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path.orEmpty().substringBefore('?')
                requests.add("${request.method} $path")
                val body = when (path) {
                    "/api/me" -> me
                    "/api/ratings" -> """{"ratings":[]}"""
                    "/api/watchlist" -> """{"watchlist":[]}"""
                    "/api/rate-queue" -> """{"items":[],"totalPages":1}"""
                    else -> "{}"
                }
                return MockResponse().setBody(body)
            }
        }
        val prefs = FakePrefs()
        val vm = viewModel(prefs)
        await(vm.me) { it != null }

        vm.setWatchlistSort("rating")

        val persisted = await(vm.watchlist) { it.sort == "rating" }
        assertEquals("rating", persisted.sort)
        assertEquals("rating", prefs.sort.value) // remembered on the device
        assertTrue(
            "watchlist sort must not sync to the server; saw ${synchronized(requests) { requests.toList() }}",
            synchronized(requests) { requests.none { it.startsWith("POST /api/settings") } },
        )
    }

    private val tenRatings = (1..10).joinToString(",") { "{\"tmdb_id\":$it,\"rating\":7}" }

    /** A dispatcher for the picks flow whose /api/recommend honours If-None-Match:
     *  304 when the sent hash equals [currentEtag], else 200 with [nextEtag] + body.
     *  Records each recommend request's If-None-Match into [sentHashes]. */
    private fun serveConditionalRecommend(
        currentEtag: String, nextEtag: String, body: String,
        sentHashes: MutableList<String?>,
    ) {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path.orEmpty().substringBefore('?')
                return when (path) {
                    "/api/me" -> MockResponse().setBody(me)
                    "/api/ratings" -> MockResponse().setBody("""{"ratings":[$tenRatings]}""")
                    "/api/watchlist" -> MockResponse().setBody("""{"watchlist":[]}""")
                    "/api/enrich" -> MockResponse().setBody("\n")
                    "/api/recommend" -> {
                        val inm = request.headers["If-None-Match"]
                        sentHashes.add(inm)
                        if (inm == currentEtag) MockResponse().setResponseCode(304)
                        else MockResponse().setHeader("ETag", nextEtag).setBody(body)
                    }
                    else -> MockResponse().setBody("{}")
                }
            }
        }
    }

    @Test
    fun `a cached discover paints instantly and a 304 keeps it (never re-fetched)`() {
        val cache = FakeDiscoverCache(
            mapOf("||" to CachedDiscover("etag-1", listOf(Pick(tmdbId = 1, title = "CachedFilm")))),
        )
        val sent = java.util.Collections.synchronizedList(mutableListOf<String?>())
        // The server would send "ServerFilm" on a 200, but a matching hash yields a 304.
        serveConditionalRecommend(
            currentEtag = "etag-1", nextEtag = "etag-x",
            body = """{"profileSize":10,"results":[{"tmdb_id":9,"media_type":"movie","title":"ServerFilm"}]}""",
            sentHashes = sent,
        )
        val vm = viewModel(cache = cache)
        val picks = await(vm.discover) { it.mode == DiscoverMode.PICKS && it.picks.isNotEmpty() }
        assertEquals("CachedFilm", picks.picks.first().title) // the cache stands; the 304 didn't replace it
        assertFalse(picks.loading)
        // The conditional request carried the cached hash (that's how the server knew nothing changed).
        assertTrue("expected If-None-Match=etag-1; saw $sent", sent.contains("etag-1"))
    }

    @Test
    fun `a changed build (200) replaces the cached discover and re-persists it`() {
        val cache = FakeDiscoverCache(
            mapOf("||" to CachedDiscover("etag-1", listOf(Pick(tmdbId = 1, title = "OldFilm")))),
        )
        val sent = java.util.Collections.synchronizedList(mutableListOf<String?>())
        serveConditionalRecommend(
            currentEtag = "nope", nextEtag = "etag-2", // never matches → always a 200 with a new hash
            body = """{"profileSize":10,"results":[{"tmdb_id":9,"media_type":"movie","title":"NewFilm"}]}""",
            sentHashes = sent,
        )
        val vm = viewModel(cache = cache)
        val picks = await(vm.discover) { it.picks.any { p -> p.title == "NewFilm" } }
        assertEquals("NewFilm", picks.picks.first().title)
        assertTrue("expected the cached hash to be sent; saw $sent", sent.contains("etag-1"))
        // The fresh build is persisted under its new hash for next launch.
        assertEquals("etag-2", cache.store["||"]?.etag)
        assertEquals("NewFilm", cache.store["||"]?.picks?.firstOrNull()?.title)
    }

    private class FakeAuth : SessionAuth {
        override fun startWebSignIn(context: Context, provider: String) {}
        override suspend fun exchangeCode(code: String) = true
        override suspend fun signOut() {}
        override suspend fun deleteAccount() {}
    }

    private class FakeRegion : RegionSource {
        override fun best(): String? = null
        override suspend fun resolveGps(geocode: suspend (Double, Double) -> String?): String? = null
    }

    private class FakePrefs(initialSort: String? = null) : AppPreferences {
        val sort = MutableStateFlow(initialSort)
        override suspend fun setLanguage(code: String) {}
        override val watchlistSort: Flow<String?> get() = sort
        override suspend fun setWatchlistSort(sort: String) { this.sort.value = sort }
    }

    // A boring in-memory stand-in for the DataStore-backed cache.
    private class FakeDiscoverCache(seed: Map<String, CachedDiscover> = emptyMap()) : DiscoverCache {
        val store = LinkedHashMap<String, CachedDiscover>().apply { putAll(seed) }
        override suspend fun get(key: String): CachedDiscover? = store[key]
        override suspend fun put(key: String, etag: String, picks: List<Pick>) {
            store[key] = CachedDiscover(etag, picks)
        }
    }
}
