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
import pl.filmowo.data.LanguageStore
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

    private fun viewModel(): FilmowoViewModel {
        val api = FilmowoApi(OkHttpClient(), server.url("/").toString())
        return FilmowoViewModel(api, FakeAuth(), FakeLang())
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

    private class FakeAuth : SessionAuth {
        override fun startWebSignIn(context: Context, provider: String) {}
        override suspend fun exchangeCode(code: String) = true
        override suspend fun signOut() {}
        override suspend fun deleteAccount() {}
    }

    private class FakeLang : LanguageStore {
        override suspend fun setLanguage(code: String) {}
    }
}
