package pl.filmowo.net

import okhttp3.Interceptor
import okhttp3.Response
import java.util.Locale

/**
 * Tags every request so the server can seed a brand-new user's streaming country
 * and interface language. The app talks to the origin directly — there's no
 * Cloudflare edge and therefore no `CF-IPCountry` header — so without this the
 * server has no geo signal and onboarding would open on an empty country in
 * English. Two independent signals:
 *  - `X-Device-Country` — the physical region from [country] (GPS / network / SIM
 *    / locale, see [pl.filmowo.location.DeviceRegion]); drives the streaming region.
 *  - `Accept-Language` — the device-locale language; drives the UI language, kept
 *    separate so a phone physically in another country doesn't flip the interface.
 * Both are read per-request so a mid-session change is picked up on the next call.
 */
class LocaleHeaderInterceptor(
    private val country: () -> String?,
    private val locale: () -> Locale = { Locale.getDefault() },
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val loc = locale()
        val builder = chain.request().newBuilder()
        val language = loc.language
        if (language.isNotBlank()) {
            builder.header("Accept-Language", if (loc.country.isNotBlank()) "$language-${loc.country}" else language)
        }
        country()?.takeIf { it.isNotBlank() }?.let { builder.header("X-Device-Country", it) }
        return chain.proceed(builder.build())
    }
}
