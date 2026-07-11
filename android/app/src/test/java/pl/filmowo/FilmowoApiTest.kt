package pl.filmowo

import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import pl.filmowo.net.FilmowoApi

/**
 * The API client against canned responses (no live server), mirroring the movies
 * app's MockWebServer test: proves URL building, query params, JSON parsing, and
 * the request shape of writes.
 */
class FilmowoApiTest {
    private lateinit var server: MockWebServer
    private lateinit var api: FilmowoApi

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        api = FilmowoApi(OkHttpClient(), server.url("/").toString())
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `me parses the account probe`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"user":{"email":"a@b.com","name":"Ann"},"anonymous":false,"onboarded":true,
                   "providers":["google"],"services":[8,337],"country":"US","language":"pl","watchlistSort":"rating"}""",
            ),
        )
        val me = api.me()
        assertEquals("a@b.com", me.user?.email)
        assertFalse(me.anonymous)
        assertTrue(me.onboarded)
        assertEquals(listOf(8, 337), me.services)
        assertEquals("US", me.country)
        assertEquals("pl", me.language)

        assertEquals("/api/me", server.takeRequest().path)
    }

    @Test
    fun `recommend folds filters into the query string`() = runTest {
        server.enqueue(MockResponse().setHeader("ETag", "\"abc\"").setBody("""{"profileSize":12,"results":[]}"""))
        val recs = api.recommend(mapOf("genre" to "Action", "type" to "tv", "refresh" to "1"))
        assertEquals(12, recs.value?.profileSize)
        assertEquals("\"abc\"", recs.etag)
        assertFalse(recs.notModified)

        val path = server.takeRequest().path!!
        assertTrue(path.startsWith("/api/recommend?"))
        assertTrue(path.contains("genre=Action"))
        assertTrue(path.contains("type=tv"))
        assertTrue(path.contains("refresh=1"))
    }

    @Test
    fun `search url-encodes the query and parses the pick results`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"results":[{"tmdb_id":7,"media_type":"tv","title":"The Wire","seasons":5,"services":[]}]}""",
            ),
        )
        val results = api.search("the wire")
        assertEquals(1, results.size)
        assertEquals("The Wire", results.first().title)
        assertEquals(5, results.first().seasons)
        assertTrue(results.first().services.isEmpty()) // strict parser tolerates an empty services array

        val req = server.takeRequest()
        assertEquals("/api/search", req.requestUrl?.encodedPath)
        assertEquals("the wire", req.requestUrl?.queryParameter("q"))
    }

    @Test
    fun `recommend sends the cached hash and surfaces a 304 as notModified`() = runTest {
        server.enqueue(MockResponse().setResponseCode(304))
        val recs = api.recommend(emptyMap(), etag = "\"abc\"")
        assertTrue(recs.notModified)
        assertNull(recs.value)
        assertEquals("\"abc\"", server.takeRequest().headers["If-None-Match"])
    }

    @Test
    fun `rate posts the star payload the server expects`() = runTest {
        server.enqueue(MockResponse().setBody("""{"ok":true}"""))
        api.rate(tmdbId = 42, mediaType = "movie", rating = 8, title = "Solaris", year = 1972)

        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/api/ratings", req.path)
        val body = req.body.readUtf8()
        assertTrue(body.contains("\"tmdb_id\":42"))
        assertTrue(body.contains("\"media_type\":\"movie\""))
        assertTrue(body.contains("\"rating\":8"))
        assertTrue(body.contains("\"title\":\"Solaris\""))
    }

    @Test
    fun `enrich parses the NDJSON stream row by row`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                "{\"key\":\"movie:1\",\"imdbRating\":7.8,\"metascore\":74}\n" +
                    "{\"key\":\"tv:2\",\"imdbRating\":8.1}\n",
            ),
        )
        val rows = api.enrich(listOf("movie:1", "tv:2"))
        assertEquals(2, rows.size)
        assertEquals("movie:1", rows[0].key)
        assertEquals(7.8, rows[0].imdbRating!!, 1e-6)
        assertEquals(74, rows[0].metascore)
        assertEquals("tv:2", rows[1].key)
    }
}
