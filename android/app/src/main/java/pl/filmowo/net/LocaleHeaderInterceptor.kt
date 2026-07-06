package pl.filmowo.net

import okhttp3.Interceptor
import okhttp3.Response
import java.util.Locale

/**
 * Tags every request with the device's locale so the server can seed a brand-new
 * user's country and interface language. The app talks to the origin directly —
 * there's no Cloudflare edge and therefore no `CF-IPCountry` header — so without
 * this the server has no geo signal and onboarding would open on an empty country
 * defaulting to English. `Accept-Language` carries the language (the server's
 * detectLanguage already reads it); `X-Device-Country` carries the region, which
 * detectCountry falls back to. The locale is read per-request so a mid-session
 * change (the user switches the device language) is picked up on the next call.
 */
class LocaleHeaderInterceptor(
    private val locale: () -> Locale = { Locale.getDefault() },
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val loc = locale()
        val builder = chain.request().newBuilder()
        val language = loc.language
        if (language.isNotBlank()) {
            builder.header("Accept-Language", if (loc.country.isNotBlank()) "$language-${loc.country}" else language)
        }
        if (loc.country.isNotBlank()) builder.header("X-Device-Country", loc.country)
        return chain.proceed(builder.build())
    }
}
