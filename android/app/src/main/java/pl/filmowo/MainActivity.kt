package pl.filmowo

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import okhttp3.OkHttpClient
import pl.filmowo.auth.AuthRepository
import pl.filmowo.data.DataStoreDiscoverCache
import pl.filmowo.data.UserPreferences
import pl.filmowo.location.DeviceRegion
import pl.filmowo.net.FilmowoApi
import pl.filmowo.net.LocaleHeaderInterceptor
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

    // Resolves the device's streaming-region country (GPS → network → SIM →
    // locale). Shared between the request interceptor and the view model so a GPS
    // fix, once resolved, rides on subsequent requests.
    private val deviceRegion by lazy { DeviceRegion(applicationContext) }

    private val viewModel: FilmowoViewModel by viewModels {
        val cookieJar = PersistentCookieJar(applicationContext)
        val httpClient = OkHttpClient.Builder()
            .cookieJar(cookieJar)
            // Send the device region + language on every request so the server can
            // seed a new user's country + language (no Cloudflare edge here → no
            // CF-IPCountry). Region and language are independent signals.
            .addInterceptor(LocaleHeaderInterceptor(country = { deviceRegion.best() }))
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
        FilmowoViewModel.Factory(api, auth, prefs, discoverCache, deviceRegion)
    }

    // A granted coarse-location permission upgrades the region to a GPS fix; a
    // denial is fine — the network/SIM/locale fallback already gives a country.
    private val locationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) viewModel.resolveDeviceRegion()
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
        requestLocationForRegion()
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
    // Ask for coarse location to pin the streaming region to where the phone
    // actually is; if already granted, resolve a GPS fix straight away. Denial is
    // harmless — the network/SIM/locale fallback still yields a country.
    private fun requestLocationForRegion() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)
            == PackageManager.PERMISSION_GRANTED) {
            viewModel.resolveDeviceRegion()
        } else {
            locationPermission.launch(Manifest.permission.ACCESS_COARSE_LOCATION)
        }
    }

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
