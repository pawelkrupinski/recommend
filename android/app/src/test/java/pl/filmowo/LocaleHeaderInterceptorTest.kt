package pl.filmowo

import okhttp3.Headers
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import pl.filmowo.net.LocaleHeaderInterceptor
import java.util.Locale

/**
 * The interceptor is the app's only geo signal to the server (no Cloudflare edge).
 * It must put two INDEPENDENT signals on the wire: X-Device-Country from the
 * resolved streaming region, and Accept-Language from the device locale — so a
 * phone physically in another country keeps its own UI language.
 */
class LocaleHeaderInterceptorTest {
    private lateinit var server: MockWebServer

    @Before fun setUp() { server = MockWebServer(); server.start() }
    @After fun tearDown() { server.shutdown() }

    private fun headersFor(country: String?, locale: Locale): Headers {
        server.enqueue(MockResponse().setBody("{}"))
        val client = OkHttpClient.Builder()
            .addInterceptor(LocaleHeaderInterceptor(country = { country }, locale = { locale }))
            .build()
        client.newCall(Request.Builder().url(server.url("/api/me")).build()).execute().close()
        return server.takeRequest().headers
    }

    @Test fun `country comes from the region, language from the locale — independently`() {
        // The reported bug: a Canadian-English phone physically in Poland. Region
        // is PL, but the interface language must stay English.
        val h = headersFor(country = "PL", locale = Locale.CANADA) // en-CA
        assertEquals("PL", h["X-Device-Country"])
        assertEquals("en-CA", h["Accept-Language"])
    }

    @Test fun `omits the country header when the region is unknown`() {
        val h = headersFor(country = null, locale = Locale("pl", "PL"))
        assertEquals("pl-PL", h["Accept-Language"])
        assertNull(h["X-Device-Country"])
    }
}
