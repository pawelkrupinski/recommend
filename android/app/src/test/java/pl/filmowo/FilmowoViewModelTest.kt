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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import pl.filmowo.auth.SessionAuth
import pl.filmowo.data.LanguageStore
import pl.filmowo.net.FilmowoApi
import pl.filmowo.ui.DiscoverMode
import pl.filmowo.ui.FilmowoViewModel

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
