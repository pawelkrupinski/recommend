package pl.filmowo

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import okhttp3.OkHttpClient
import pl.filmowo.auth.AuthRepository
import pl.filmowo.data.DataStoreDiscoverCache
import pl.filmowo.data.UserPreferences
import pl.filmowo.net.FilmowoApi
import pl.filmowo.net.PersistentCookieJar
import pl.filmowo.ui.FilmowoApp
import pl.filmowo.ui.FilmowoViewModel
import pl.filmowo.ui.theme.Background
import pl.filmowo.ui.theme.FilmowoTheme
import java.util.concurrent.TimeUnit

/**
 * Single-activity entry point and composition root (manual DI — no framework, the
 * movies app's convention). One shared OkHttp client with a disk-backed cookie
 * jar carries the `rid` session across every call and app restarts; the API
 * client, auth repository, DataStore prefs, and the view model hang off it.
 */
class MainActivity : ComponentActivity() {

    private val viewModel: FilmowoViewModel by viewModels {
        val cookieJar = PersistentCookieJar(applicationContext)
        val httpClient = OkHttpClient.Builder()
            .cookieJar(cookieJar)
            // A short connect timeout so an unreachable server fails fast (→ the
            // boot error screen), but a generous read timeout because a cold
            // /api/recommend picks-build takes ~15s+ on the shared-CPU host — too
            // tight a read timeout was turning that slow build into a failure.
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(45, TimeUnit.SECONDS)
            .build()
        val api = FilmowoApi(httpClient, BuildConfig.BASE_URL)
        val auth = AuthRepository(httpClient, cookieJar, BuildConfig.BASE_URL)
        val prefs = UserPreferences(applicationContext)
        val discoverCache = DataStoreDiscoverCache(applicationContext)
        FilmowoViewModel.Factory(api, auth, prefs, discoverCache)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Dark-only UI: force light system-bar icons so they stay visible against
        // the near-black background regardless of the device's night mode.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        handleAuthDeepLink(intent)
        setContent {
            FilmowoTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = Background) {
                    FilmowoApp(viewModel)
                }
            }
        }
    }

    // The OAuth callback bounces back as filmowo://auth-done?code=…. singleTask
    // means a redirect into the running app lands here; a cold start lands in
    // onCreate's intent — both funnel through handleAuthDeepLink.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleAuthDeepLink(intent)
    }

    private fun handleAuthDeepLink(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme == "filmowo" && data.host == "auth-done") {
            data.getQueryParameter("code")?.let { viewModel.handleAuthRedirect(it) }
        }
    }
}
