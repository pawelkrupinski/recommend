package pl.filmowo.location

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import androidx.core.os.CancellationSignal
import kotlinx.coroutines.suspendCancellableCoroutine
import java.util.Locale
import kotlin.coroutines.resume

/** The streaming-region country source the view model depends on (a seam so tests
 *  swap in a fake without an Android Context). Production impl: [DeviceRegion]. */
interface RegionSource {
    /** The best country code known right now (ISO-3166 alpha-2, uppercase), or null. */
    fun best(): String?
    /** Resolve + cache a GPS-fix country via [geocode]; null when unavailable. */
    suspend fun resolveGps(geocode: suspend (Double, Double) -> String?): String?
}

/**
 * The device's country for the streaming REGION, resolved most-precise-first: a
 * GPS fix once the user grants it, else the mobile-network country (the country
 * the phone is currently in — right even when the SIM's home or the OS language
 * is elsewhere), else the SIM's home country, else the device-locale region.
 *
 * This is deliberately about location, not language: a Canadian-English phone in
 * Poland reports PL here so picks are streamable locally, while the UI language
 * still follows the device locale (carried separately on Accept-Language by
 * [pl.filmowo.net.LocaleHeaderInterceptor]). The server keeps the two apart too.
 */
class DeviceRegion(private val context: Context) : RegionSource {
    // Cached GPS result (uppercased ISO code). Volatile: written from a coroutine,
    // read from OkHttp's interceptor thread on every request.
    @Volatile private var gps: String? = null

    override fun best(): String? = pickCountry(gps, networkCountry(), simCountry(), Locale.getDefault().country)

    private fun telephony() = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
    private fun networkCountry() = telephony()?.networkCountryIso
    private fun simCountry() = telephony()?.simCountryIso

    private fun hasPermission() =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    /**
     * Resolve the country from a one-shot GPS fix via [geocode] and cache it as the
     * top-priority override. Returns null (and changes nothing) when the permission
     * isn't granted, no fix is available, or the fix can't be geocoded. Never throws.
     */
    override suspend fun resolveGps(geocode: suspend (Double, Double) -> String?): String? {
        if (!hasPermission()) return null
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return null
        val loc = currentLocation(lm) ?: return null
        val country = runCatching { geocode(loc.latitude, loc.longitude) }.getOrNull()
        val code = pickCountry(country)
        if (code != null) gps = code
        return code
    }

    @Suppress("MissingPermission") // guarded by hasPermission() above
    private suspend fun currentLocation(lm: LocationManager): Location? = suspendCancellableCoroutine { cont ->
        val provider = listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER)
            .firstOrNull { runCatching { lm.isProviderEnabled(it) }.getOrDefault(false) }
        if (provider == null) { cont.resume(null); return@suspendCancellableCoroutine }
        val signal = CancellationSignal()
        cont.invokeOnCancellation { signal.cancel() }
        LocationManagerCompat.getCurrentLocation(lm, provider, signal, ContextCompat.getMainExecutor(context)) { loc ->
            cont.resume(loc)
        }
    }

    companion object {
        /** First well-formed 2-letter country among the candidates, uppercased. Pure. */
        internal fun pickCountry(vararg candidates: String?): String? =
            candidates.firstNotNullOfOrNull { c ->
                c?.trim()?.uppercase()?.takeIf { it.length == 2 && it.all(Char::isLetter) }
            }
    }
}
