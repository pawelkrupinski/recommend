package pl.filmowo

import androidx.test.core.app.ApplicationProvider
import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import pl.filmowo.net.PersistentCookieJar

/**
 * The disk-backed cookie jar keeps the session across "restarts" (a fresh jar
 * over the same SharedPreferences), so the signed-in `rid` cookie survives.
 * Robolectric supplies a real Context off-device.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34]) // Robolectric doesn't ship an SDK 37 sandbox yet; pin a supported one.
class PersistentCookieJarTest {
    private val url = "https://filmowo.fly.dev/api/me".toHttpUrl()

    private fun ridCookie() = Cookie.Builder()
        .name("rid").value("session-token")
        .domain("filmowo.fly.dev").path("/")
        .expiresAt(System.currentTimeMillis() + 30L * 24 * 60 * 60 * 1000)
        .httpOnly().secure()
        .build()

    @Test
    fun `a saved session cookie is reloaded by a fresh jar`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        PersistentCookieJar(context).saveFromResponse(url, listOf(ridCookie()))

        val reloaded = PersistentCookieJar(context).loadForRequest(url)
        assertEquals(1, reloaded.size)
        assertEquals("rid", reloaded[0].name)
        assertEquals("session-token", reloaded[0].value)
    }

    @Test
    fun `clear wipes the stored session`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val jar = PersistentCookieJar(context)
        jar.saveFromResponse(url, listOf(ridCookie()))
        jar.clear()

        assertTrue(PersistentCookieJar(context).loadForRequest(url).isEmpty())
    }
}
