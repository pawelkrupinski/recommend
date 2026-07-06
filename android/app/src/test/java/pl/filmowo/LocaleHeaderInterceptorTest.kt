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
 * The interceptor is the app's only geo signal to the server (no Cloudflare edge),
 * so it must put the device locale on the wire: Accept-Language + X-Device-Country.
 */
class LocaleHeaderInterceptorTest {
    private lateinit var server: MockWebServer

    @Before fun setUp() { server = MockWebServer(); server.start() }
    @After fun tearDown() { server.shutdown() }

    private fun headersFor(locale: Locale): Headers {
        server.enqueue(MockResponse().setBody("{}"))
        val client = OkHttpClient.Builder().addInterceptor(LocaleHeaderInterceptor { locale }).build()
        client.newCall(Request.Builder().url(server.url("/api/me")).build()).execute().close()
        return server.takeRequest().headers
    }

    @Test fun `tags language and country from a full locale`() {
        val h = headersFor(Locale.UK) // en-GB
        assertEquals("en-GB", h["Accept-Language"])
        assertEquals("GB", h["X-Device-Country"])
    }

    @Test fun `maps a Polish device to a pl-PL language and PL country`() {
        val h = headersFor(Locale("pl", "PL"))
        assertEquals("pl-PL", h["Accept-Language"])
        assertEquals("PL", h["X-Device-Country"])
    }

    @Test fun `omits the country header when the locale carries no region`() {
        val h = headersFor(Locale("pl")) // language only, no country
        assertEquals("pl", h["Accept-Language"])
        assertNull(h["X-Device-Country"])
    }
}
