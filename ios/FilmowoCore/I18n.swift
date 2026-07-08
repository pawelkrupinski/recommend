import Foundation

/// Tiny in-app message catalog mirroring the web app's `public/i18n.js` and the
/// Android `i18n/I18n.kt`: a flat key→string map per language (en, pl) with
/// `{placeholder}` fills, keyed off the user's server-chosen language rather than
/// the device locale. Content (titles, synopses, genres) is already localized
/// server-side by the language setting; this covers only the app's own chrome.
public enum I18n {
    /// Look up `key` in `lang`, falling back to English, then to the raw key,
    /// and substitute `{name}` placeholders from `fills`.
    public static func t(_ lang: String, _ key: String, _ fills: [String: String] = [:]) -> String {
        var s = (lang == "pl" ? pl : en)[key] ?? en[key] ?? key
        for (k, v) in fills { s = s.replacingOccurrences(of: "{\(k)}", with: v) }
        return s
    }

    /// Languages the in-app catalog covers (the settings picker offers these).
    public static let supportedLanguages = ["en", "pl"]

    public static let en: [String: String] = [
        "nav.discover": "Discover",
        "nav.watchlist": "Watchlist",
        "nav.ratings": "Ratings",
        "nav.settings": "Settings",
        "discover.empty": "No picks yet. Pick your streaming services in Settings, then rate some films.",
        "discover.rateMore": "Rate {n} more to unlock your picks",
        "discover.building": "Building your picks…",
        "filter.allGenres": "All genres",
        "filter.allTones": "All tones",
        "filter.allTypes": "All types",
        "filter.movie": "Movies",
        "filter.tv": "Series",
        "card.notInterested": "Not interested / seen it",
        "card.save": "Save to watchlist",
        "card.rateHint": "Tap a star to rate",
        "detail.director": "Director",
        "detail.cast": "Cast",
        "detail.trailer": "Trailer",
        "detail.notAvailable": "Not on your services in this country right now.",
        "detail.watchedRate": "Watched it? Rate it — that moves it out of your watchlist.",
        "detail.whereToWatch": "Where to watch",
        "watchlist.remove": "Remove from watchlist",
        "watchlist.empty": "Your watchlist is empty. Save a Discover pick to see it here.",
        "watchlist.count": "{n} saved titles",
        "watchlist.sortAdded": "Recently added",
        "watchlist.sortRating": "Top rated",
        "ratings.empty": "You haven't rated anything yet.",
        "ratings.count": "{n} rated titles",
        "settings.account": "Account",
        "settings.anonymous": "Browsing anonymously",
        "settings.signInGoogle": "Sign in with Google",
        "settings.signInFacebook": "Sign in with Facebook",
        "settings.signOut": "Sign out",
        "settings.deleteAccount": "Delete account & data",
        "settings.language": "Language",
        "settings.country": "Country",
        "settings.services": "Streaming services",
        "onboarding.welcome": "Welcome to Filmowo",
        "onboarding.intro": "Pick your language, country and streaming services to get started.",
        "onboarding.start": "Get started",
        "onboarding.haveAccount": "Already have an account? Sign in",
        "login.title": "Sign in",
        "login.intro": "Sign in to sync your ratings and picks across your devices.",
        "login.noProviders": "No sign-in providers are available right now.",
        "common.back": "Back",
        "common.retry": "Retry",
        "error.offline": "Couldn't reach the server. Check your connection and try again.",
        "common.close": "Close",
    ]

    public static let pl: [String: String] = [
        "nav.discover": "Odkrywaj",
        "nav.watchlist": "Do obejrzenia",
        "nav.ratings": "Oceny",
        "nav.settings": "Ustawienia",
        "discover.empty": "Brak propozycji. Wybierz swoje serwisy w Ustawieniach i oceń kilka filmów.",
        "discover.rateMore": "Oceń jeszcze {n}, aby odblokować propozycje",
        "discover.building": "Przygotowuję propozycje…",
        "filter.allGenres": "Wszystkie gatunki",
        "filter.allTones": "Wszystkie nastroje",
        "filter.allTypes": "Wszystkie typy",
        "filter.movie": "Filmy",
        "filter.tv": "Seriale",
        "card.notInterested": "Nie interesuje mnie / widziałem",
        "card.save": "Zapisz do obejrzenia",
        "card.rateHint": "Dotknij gwiazdki, aby ocenić",
        "detail.director": "Reżyser",
        "detail.cast": "Obsada",
        "detail.trailer": "Zwiastun",
        "detail.notAvailable": "Aktualnie niedostępne w Twoich serwisach w tym kraju.",
        "detail.watchedRate": "Obejrzałeś? Oceń — to usunie tytuł z listy do obejrzenia.",
        "detail.whereToWatch": "Gdzie obejrzeć",
        "watchlist.remove": "Usuń z listy",
        "watchlist.empty": "Twoja lista jest pusta. Zapisz propozycję, aby ją tu zobaczyć.",
        "watchlist.count": "Zapisane tytuły: {n}",
        "watchlist.sortAdded": "Ostatnio dodane",
        "watchlist.sortRating": "Najwyżej oceniane",
        "ratings.empty": "Nie oceniłeś jeszcze żadnego tytułu.",
        "ratings.count": "Ocenione tytuły: {n}",
        "settings.account": "Konto",
        "settings.anonymous": "Przeglądasz anonimowo",
        "settings.signInGoogle": "Zaloguj przez Google",
        "settings.signInFacebook": "Zaloguj przez Facebook",
        "settings.signOut": "Wyloguj się",
        "settings.deleteAccount": "Usuń konto i dane",
        "settings.language": "Język",
        "settings.country": "Kraj",
        "settings.services": "Serwisy streamingowe",
        "onboarding.welcome": "Witaj w Filmowo",
        "onboarding.intro": "Wybierz język, kraj i serwisy, aby zacząć.",
        "onboarding.start": "Zaczynajmy",
        "onboarding.haveAccount": "Masz już konto? Zaloguj się",
        "login.title": "Zaloguj się",
        "login.intro": "Zaloguj się, aby synchronizować oceny i propozycje między urządzeniami.",
        "login.noProviders": "Brak dostępnych metod logowania.",
        "common.back": "Wstecz",
        "common.retry": "Ponów",
        "error.offline": "Nie można połączyć się z serwerem. Sprawdź połączenie i spróbuj ponownie.",
        "common.close": "Zamknij",
    ]
}
