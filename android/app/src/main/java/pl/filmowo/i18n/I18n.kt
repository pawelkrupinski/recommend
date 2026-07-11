package pl.filmowo.i18n

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.compositionLocalOf

/**
 * Tiny in-app message catalog mirroring the web app's public/i18n.js: a flat
 * key→string map per language (en, pl) with {placeholder} fills, keyed off the
 * user's server-chosen language rather than the device locale. Content (titles,
 * synopses, genres) is already localized server-side by the language setting;
 * this covers only the app's own chrome.
 */
object I18n {
    fun t(lang: String, key: String, fills: Map<String, String> = emptyMap()): String {
        var s = (if (lang == "pl") PL else EN)[key] ?: EN[key] ?: key
        for ((k, v) in fills) s = s.replace("{$k}", v)
        return s
    }

    private val EN = mapOf(
        "nav.discover" to "Discover",
        "nav.watchlist" to "Watchlist",
        "nav.ratings" to "Ratings",
        "nav.settings" to "Settings",
        "nav.search" to "Search",
        "search.hint" to "Search films & series by name",
        "search.prompt" to "Search for a film or series by name.",
        "search.empty" to "Nothing found on your services. Try another title.",
        "discover.empty" to "No picks yet. Pick your streaming services in Settings, then rate some films.",
        "discover.rateMore" to "Rate {n} more to unlock your picks",
        "discover.building" to "Building your picks…",
        "filter.allGenres" to "All genres",
        "filter.allTones" to "All tones",
        "filter.allTypes" to "All types",
        "filter.movie" to "Movies",
        "filter.tv" to "Series",
        "card.notInterested" to "Not interested / seen it",
        "card.notSeen" to "Haven't seen",
        "card.save" to "Save to watchlist",
        "card.rateHint" to "Tap a star to rate",
        "detail.director" to "Director",
        "detail.cast" to "Cast",
        "detail.trailer" to "Trailer",
        "detail.notAvailable" to "Not on your services in this country right now.",
        "detail.watchedRate" to "Watched it? Rate it — that moves it out of your watchlist.",
        "detail.whereToWatch" to "Where to watch",
        "watchlist.remove" to "Remove from watchlist",
        "watchlist.empty" to "Your watchlist is empty. Save a Discover pick to see it here.",
        "watchlist.count" to "{n} saved titles",
        "watchlist.sortAdded" to "Recently added",
        "watchlist.sortRating" to "Top rated",
        "ratings.empty" to "You haven't rated anything yet.",
        "ratings.count" to "{n} rated titles",
        "settings.account" to "Account",
        "settings.anonymous" to "Browsing anonymously",
        "settings.signInGoogle" to "Sign in with Google",
        "settings.signInFacebook" to "Sign in with Facebook",
        "settings.signOut" to "Sign out",
        "settings.deleteAccount" to "Delete account & data",
        "settings.language" to "Language",
        "settings.country" to "Country",
        "settings.services" to "Streaming services",
        "onboarding.welcome" to "Welcome to Filmowo",
        "onboarding.intro" to "Pick your language, country and streaming services to get started.",
        "onboarding.start" to "Get started",
        "onboarding.haveAccount" to "Already have an account? Sign in",
        "login.title" to "Sign in",
        "login.intro" to "Sign in to sync your ratings and picks across your devices.",
        "login.noProviders" to "No sign-in providers are available right now.",
        "common.back" to "Back",
        "common.retry" to "Retry",
        "error.offline" to "Couldn't reach the server. Check your connection and try again.",
        "common.close" to "Close",
    )

    private val PL = mapOf(
        "nav.discover" to "Odkrywaj",
        "nav.watchlist" to "Do obejrzenia",
        "nav.ratings" to "Oceny",
        "nav.settings" to "Ustawienia",
        "nav.search" to "Szukaj",
        "search.hint" to "Szukaj filmów i seriali po nazwie",
        "search.prompt" to "Wyszukaj film lub serial po nazwie.",
        "search.empty" to "Nic nie znaleziono w Twoich serwisach. Spróbuj innego tytułu.",
        "discover.empty" to "Brak propozycji. Wybierz swoje serwisy w Ustawieniach i oceń kilka filmów.",
        "discover.rateMore" to "Oceń jeszcze {n}, aby odblokować propozycje",
        "discover.building" to "Przygotowuję propozycje…",
        "filter.allGenres" to "Wszystkie gatunki",
        "filter.allTones" to "Wszystkie nastroje",
        "filter.allTypes" to "Wszystkie typy",
        "filter.movie" to "Filmy",
        "filter.tv" to "Seriale",
        "card.notInterested" to "Nie interesuje mnie / widziałem",
        "card.notSeen" to "Nie widziałem",
        "card.save" to "Zapisz do obejrzenia",
        "card.rateHint" to "Dotknij gwiazdki, aby ocenić",
        "detail.director" to "Reżyser",
        "detail.cast" to "Obsada",
        "detail.trailer" to "Zwiastun",
        "detail.notAvailable" to "Aktualnie niedostępne w Twoich serwisach w tym kraju.",
        "detail.watchedRate" to "Obejrzałeś? Oceń — to usunie tytuł z listy do obejrzenia.",
        "detail.whereToWatch" to "Gdzie obejrzeć",
        "watchlist.remove" to "Usuń z listy",
        "watchlist.empty" to "Twoja lista jest pusta. Zapisz propozycję, aby ją tu zobaczyć.",
        "watchlist.count" to "Zapisane tytuły: {n}",
        "watchlist.sortAdded" to "Ostatnio dodane",
        "watchlist.sortRating" to "Najwyżej oceniane",
        "ratings.empty" to "Nie oceniłeś jeszcze żadnego tytułu.",
        "ratings.count" to "Ocenione tytuły: {n}",
        "settings.account" to "Konto",
        "settings.anonymous" to "Przeglądasz anonimowo",
        "settings.signInGoogle" to "Zaloguj przez Google",
        "settings.signInFacebook" to "Zaloguj przez Facebook",
        "settings.signOut" to "Wyloguj się",
        "settings.deleteAccount" to "Usuń konto i dane",
        "settings.language" to "Język",
        "settings.country" to "Kraj",
        "settings.services" to "Serwisy streamingowe",
        "onboarding.welcome" to "Witaj w Filmowo",
        "onboarding.intro" to "Wybierz język, kraj i serwisy, aby zacząć.",
        "onboarding.start" to "Zaczynajmy",
        "onboarding.haveAccount" to "Masz już konto? Zaloguj się",
        "login.title" to "Zaloguj się",
        "login.intro" to "Zaloguj się, aby synchronizować oceny i propozycje między urządzeniami.",
        "login.noProviders" to "Brak dostępnych metod logowania.",
        "common.back" to "Wstecz",
        "common.retry" to "Ponów",
        "error.offline" to "Nie można połączyć się z serwerem. Sprawdź połączenie i spróbuj ponownie.",
        "common.close" to "Zamknij",
    )
}

/** The active UI language, provided at the app root from the ViewModel's Me state. */
val LocalLanguage = compositionLocalOf { "en" }

@Composable
@ReadOnlyComposable
fun t(key: String, fills: Map<String, String> = emptyMap()): String =
    I18n.t(LocalLanguage.current, key, fills)
