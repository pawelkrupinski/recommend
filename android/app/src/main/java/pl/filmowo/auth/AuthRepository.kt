package pl.filmowo.auth

import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import pl.filmowo.net.PersistentCookieJar

/**
 * Owns the signed-in session, mirroring the movies app's AuthRepository.
 *
 * Sign-in opens the server's web OAuth flow (Google / Facebook) in a Custom Tab,
 * which shares no cookies with the app; the server bounces back to the
 * `filmowo://auth-done?code=…` deep link, and [exchangeCode] redeems that
 * one-shot code at `/auth/exchange` for the `rid` session cookie. The cookie
 * lands in the shared [PersistentCookieJar] (the same [OkHttpClient] used for
 * every call), so the session rides on `/api/me` etc. and survives restarts.
 */
class AuthRepository(
    private val client: OkHttpClient,
    private val cookieJar: PersistentCookieJar,
    private val baseUrl: String,
) : SessionAuth {
    private val json = Json { ignoreUnknownKeys = true }

    /** Open the provider's web consent flow; the result returns via the deep link. */
    override fun startWebSignIn(context: Context, provider: String) {
        val url = "$baseUrl/auth/$provider?platform=android"
        CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(url))
    }

    /** Redeem the one-shot deep-link code for a session cookie. Returns success. */
    override suspend fun exchangeCode(code: String): Boolean = withContext(Dispatchers.IO) {
        val body = json.encodeToString(CodeRequest(code)).toRequestBody(JSON_MEDIA)
        val request = Request.Builder()
            .url("$baseUrl/auth/exchange").header("User-Agent", UA).post(body).build()
        runCatching { client.newCall(request).execute().use { it.isSuccessful } }.getOrDefault(false)
    }

    /** End the session server-side and locally, so the app falls back to a fresh anon. */
    override suspend fun signOut() = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$baseUrl/auth/logout").header("User-Agent", UA).build()
        runCatching { client.newCall(request).execute().close() }
        cookieJar.clear()
    }

    /** Erase the account (or, when anonymous, all local data) and drop the session. */
    override suspend fun deleteAccount() = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$baseUrl/api/me").header("User-Agent", UA).delete().build()
        runCatching { client.newCall(request).execute().close() }
        cookieJar.clear()
    }

    @Serializable
    private data class CodeRequest(val code: String)

    private companion object {
        const val UA = "FilmowoAndroid/1.0"
        val JSON_MEDIA = "application/json".toMediaType()
    }
}
