package pl.filmowo.net

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

/**
 * A disk-backed [CookieJar] so the signed-in `rid` session cookie survives app
 * restarts. OkHttp ships no cookie store at all, so we persist one to
 * SharedPreferences and reload it on construction. Copied from the movies app.
 *
 * The whole cookie set is tiny (one session cookie in practice), so each write
 * re-serialises the lot. Expired cookies are dropped on load and on every save.
 */
class PersistentCookieJar(context: Context) : CookieJar {

    private val store = context.getSharedPreferences("filmowo_cookies", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

    // Keyed by identity (name + domain + path) so a refreshed cookie replaces
    // the old one rather than accumulating duplicates.
    private val cookies = LinkedHashMap<String, Cookie>()

    init {
        store.getString(KEY, null)?.let { raw ->
            runCatching { json.decodeFromString<List<Record>>(raw) }
                .getOrDefault(emptyList())
                .map { it.toCookie() }
                .filter { it.expiresAt > now() }
                .forEach { cookies[keyOf(it)] = it }
        }
    }

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, responseCookies: List<Cookie>) {
        for (cookie in responseCookies) {
            val k = keyOf(cookie)
            if (cookie.expiresAt <= now()) cookies.remove(k) else cookies[k] = cookie
        }
        persist()
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val live = cookies.values.filter { it.expiresAt > now() }
        if (live.size != cookies.size) {
            cookies.clear()
            live.forEach { cookies[keyOf(it)] = it }
            persist()
        }
        return live.filter { it.matches(url) }
    }

    /** Wipe every stored cookie — used on sign-out / account deletion. */
    @Synchronized
    fun clear() {
        cookies.clear()
        store.edit().remove(KEY).apply()
    }

    private fun persist() {
        val raw = json.encodeToString(cookies.values.map(Record::from))
        store.edit().putString(KEY, raw).apply()
    }

    private fun now() = System.currentTimeMillis()

    private fun keyOf(c: Cookie) = "${c.name} ${c.domain} ${c.path}"

    @Serializable
    private data class Record(
        val name: String,
        val value: String,
        val domain: String,
        val path: String,
        val expiresAt: Long,
        val secure: Boolean,
        val httpOnly: Boolean,
        val hostOnly: Boolean,
    ) {
        fun toCookie(): Cookie {
            val b = Cookie.Builder().name(name).value(value).path(path).expiresAt(expiresAt)
            if (hostOnly) b.hostOnlyDomain(domain) else b.domain(domain)
            if (secure) b.secure()
            if (httpOnly) b.httpOnly()
            return b.build()
        }

        companion object {
            fun from(c: Cookie) = Record(
                name = c.name, value = c.value, domain = c.domain, path = c.path,
                expiresAt = c.expiresAt, secure = c.secure, httpOnly = c.httpOnly,
                hostOnly = c.hostOnly,
            )
        }
    }

    private companion object {
        const val KEY = "cookies"
    }
}
