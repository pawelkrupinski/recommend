// Tiny dependency-free interface i18n. Plain ESM so app.js imports it in the
// browser and the unit suite imports it under node. `MESSAGES` is a flat
// key → string catalog per language; values may carry {placeholders}. The
// language list mirrors the server's SUPPORTED_LANGUAGES (a unit test asserts
// the two stay in sync). Adding a language = one entry here + one in locale.js.

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'pl', name: 'Polski' },
];
const DEFAULT_LANGUAGE = 'en';

export const MESSAGES = {
  en: {
    // onboarding
    'ob.welcome': '🎬 Welcome',
    'ob.intro': 'Tell us where you watch so every pick is something you can actually stream tonight.',
    'ob.continue': 'Continue →',
    'ob.changeLater': 'You can change these any time in Settings.',
    'label.country': 'Country',
    'label.language': 'Language',
    // tabs
    'tab.discover': 'Discover',
    'tab.watchlist': 'Watchlist',
    'tab.ratings': 'My ratings',
    'tab.settings': 'Settings',
    // login overlay
    'login.intro': 'Sign in to sync your ratings and picks across devices. Your current picks come with you.',
    'login.privacy': 'Privacy policy',
    'auth.signIn': 'Sign in',
    'auth.signOut': 'Sign out',
    'auth.signInWith': 'Sign in with {provider}',
    'auth.noProviders': 'No login providers are configured on the server yet.',
    // discover
    'discover.building': 'Building your picks…',
    'discover.buildingPersonalized': 'Building your personalized picks…',
    'discover.onboardCountdown': "Rate films you've seen so we can learn your taste — {left} more to go.",
    'discover.ratedEverything': "You've rated everything we had to show — switching to your personalized picks.",
    'discover.refresh': '↻ Refresh picks',
    'discover.filterTitle': 'Filter picks by genre',
    'discover.originTitle': 'Filter picks by where the film is from',
    'discover.toneTitle': 'Filter picks by tone',
    'discover.tonePlaceholder': 'Any tone',
    'genre.all': 'All genres',
    'origin.any': 'Any origin',
    'origin.allOf': 'All of {name}',
    'filter.excludeUs': 'Non-US',
    'filter.indie': 'Indie only',
    'discover.picksSummary': '{count} picks from a taste profile of {profile} rated films.',
    'discover.picksSummaryGenre': '{count} picks in {genre} from a taste profile of {profile} rated films.',
    'discover.picksEmptyMore': 'No more picks here — hit “Refresh picks” for more.',
    'discover.emptyGenre': 'No picks in this genre on your services. Try “All genres” or another genre.',
    'discover.emptyNoPicks': 'No picks yet. Add your TMDB key + streaming services in Settings, then rate some films.',
    // rate / dismiss widget
    'card.notInterested': 'Not interested / seen it',
    'card.notSeen': "Haven't seen",
    'aria.close': 'Close',
    // where-to-watch modal
    'modal.loadingAvailability': 'Loading availability…',
    'modal.notAvailable': 'Not on your subscription services in this country right now.',
    'modal.director': 'Director',
    'modal.cast': 'Cast',
    'modal.trailer': 'Trailer',
    // watchlist
    'watchlist.empty': 'Your watchlist is empty. Hit + on a Discover pick to save it for later.',
    'watchlist.emptyFiltered': 'No saved titles match this filter.',
    'watchlist.count': '{n} saved titles',
    'watchlist.remove': 'Remove from watchlist',
    'watchlist.toneTitle': 'Filter your watchlist by tone',
    'watchlist.allTones': 'All tones',
    'watchlist.genreTitle': 'Filter your watchlist by genre',
    'watchlist.sortTitle': 'Sort your watchlist',
    'watchlist.sortAdded': 'Recently added',
    'watchlist.sortRating': 'Top rated',
    // ratings
    'ratings.count': '{n} rated titles',
    'ratings.empty': 'No ratings yet.',
    // settings
    'settings.servicesHeading': 'Your streaming services',
    'settings.servicesHint': 'Picks are filtered to titles streamable on these in your country.',
    'settings.saved': '✓ Saved',
    'settings.languageHeading': 'Interface language',
    'settings.accountHeading': 'Your account',
    'settings.privacyRead': 'Read our ',
    'settings.privacyPolicy': 'privacy policy',
    'settings.deleteWarn': '. Deleting your account permanently erases your profile, ratings and preferences. This cannot be undone.',
    'settings.deleteAccount': 'Delete account',
    // provider picker
    'providers.loading': 'Loading services…',
    'providers.sourceTmdb': 'Service list from TMDB.',
    'providers.errorSetKey': '⚠ {msg} — set your TMDB key first.',
    // delete account
    'account.confirmAnon': 'Clear all your ratings and preferences on this device? This cannot be undone.',
    'account.confirmUser': 'Delete your account and all your ratings and preferences? This cannot be undone.',
    'account.deleting': 'Deleting…',
    'account.deleteFailed': 'Could not delete account: {msg}',
  },
  pl: {
    // onboarding
    'ob.welcome': '🎬 Witaj',
    'ob.intro': 'Powiedz nam, gdzie oglądasz, aby każda propozycja była czymś, co naprawdę możesz obejrzeć dziś wieczorem.',
    'ob.continue': 'Dalej →',
    'ob.changeLater': 'Możesz to zmienić w dowolnej chwili w Ustawieniach.',
    'label.country': 'Kraj',
    'label.language': 'Język',
    // tabs
    'tab.discover': 'Odkrywaj',
    'tab.watchlist': 'Do obejrzenia',
    'tab.ratings': 'Moje oceny',
    'tab.settings': 'Ustawienia',
    // login overlay
    'login.intro': 'Zaloguj się, aby synchronizować oceny i propozycje na różnych urządzeniach. Twoje obecne propozycje pozostaną z Tobą.',
    'login.privacy': 'Polityka prywatności',
    'auth.signIn': 'Zaloguj się',
    'auth.signOut': 'Wyloguj się',
    'auth.signInWith': 'Zaloguj się przez {provider}',
    'auth.noProviders': 'Na serwerze nie skonfigurowano jeszcze żadnych dostawców logowania.',
    // discover
    'discover.building': 'Tworzymy Twoje propozycje…',
    'discover.buildingPersonalized': 'Tworzymy Twoje spersonalizowane propozycje…',
    'discover.onboardCountdown': 'Oceniaj filmy, które widziałeś, abyśmy poznali Twój gust — jeszcze {left} do celu.',
    'discover.ratedEverything': 'Oceniłeś wszystko, co mieliśmy do pokazania — przełączamy na spersonalizowane propozycje.',
    'discover.refresh': '↻ Odśwież propozycje',
    'discover.filterTitle': 'Filtruj propozycje według gatunku',
    'discover.originTitle': 'Filtruj propozycje według kraju pochodzenia filmu',
    'discover.toneTitle': 'Filtruj propozycje według nastroju',
    'discover.tonePlaceholder': 'Dowolny nastrój',
    'genre.all': 'Wszystkie gatunki',
    'origin.any': 'Dowolne pochodzenie',
    'origin.allOf': 'Cały region: {name}',
    'filter.excludeUs': 'Spoza USA',
    'filter.indie': 'Tylko niezależne',
    'discover.picksSummary': 'Propozycje: {count} na podstawie profilu gustu z {profile} ocenionych filmów.',
    'discover.picksSummaryGenre': 'Propozycje: {count} w gatunku {genre} na podstawie profilu gustu z {profile} ocenionych filmów.',
    'discover.picksEmptyMore': 'Brak kolejnych propozycji — kliknij „Odśwież propozycje”, aby zobaczyć więcej.',
    'discover.emptyGenre': 'Brak propozycji w tym gatunku w Twoich serwisach. Wybierz „Wszystkie gatunki” lub inny gatunek.',
    'discover.emptyNoPicks': 'Brak propozycji. Dodaj klucz TMDB i serwisy streamingowe w Ustawieniach, a potem oceń kilka filmów.',
    // rate / dismiss widget
    'card.notInterested': 'Nie interesuje mnie / widziałem',
    'card.notSeen': 'Nie widziałem',
    'aria.close': 'Zamknij',
    // where-to-watch modal
    'modal.loadingAvailability': 'Sprawdzam dostępność…',
    'modal.notAvailable': 'Aktualnie niedostępne w Twoich serwisach abonamentowych w tym kraju.',
    'modal.director': 'Reżyser',
    'modal.cast': 'Obsada',
    'modal.trailer': 'Zwiastun',
    // watchlist
    'watchlist.empty': 'Twoja lista do obejrzenia jest pusta. Kliknij + na propozycji, aby zapisać ją na później.',
    'watchlist.emptyFiltered': 'Brak zapisanych tytułów pasujących do tego filtra.',
    'watchlist.count': 'Zapisane tytuły: {n}',
    'watchlist.remove': 'Usuń z listy',
    'watchlist.toneTitle': 'Filtruj listę według nastroju',
    'watchlist.allTones': 'Wszystkie nastroje',
    'watchlist.genreTitle': 'Filtruj listę według gatunku',
    'watchlist.sortTitle': 'Sortuj listę',
    'watchlist.sortAdded': 'Ostatnio dodane',
    'watchlist.sortRating': 'Najwyżej oceniane',
    // ratings
    'ratings.count': 'Ocenione tytuły: {n}',
    'ratings.empty': 'Brak ocen.',
    // settings
    'settings.servicesHeading': 'Twoje serwisy streamingowe',
    'settings.servicesHint': 'Propozycje są ograniczone do tytułów dostępnych w tych serwisach w Twoim kraju.',
    'settings.saved': '✓ Zapisano',
    'settings.languageHeading': 'Język interfejsu',
    'settings.accountHeading': 'Twoje konto',
    'settings.privacyRead': 'Przeczytaj naszą ',
    'settings.privacyPolicy': 'politykę prywatności',
    'settings.deleteWarn': '. Usunięcie konta trwale kasuje Twój profil, oceny i preferencje. Tej operacji nie można cofnąć.',
    'settings.deleteAccount': 'Usuń konto',
    // provider picker
    'providers.loading': 'Ładowanie serwisów…',
    'providers.sourceTmdb': 'Lista serwisów z TMDB.',
    'providers.errorSetKey': '⚠ {msg} — najpierw ustaw klucz TMDB.',
    // delete account
    'account.confirmAnon': 'Wyczyścić wszystkie Twoje oceny i preferencje na tym urządzeniu? Tej operacji nie można cofnąć.',
    'account.confirmUser': 'Usunąć Twoje konto oraz wszystkie oceny i preferencje? Tej operacji nie można cofnąć.',
    'account.deleting': 'Usuwanie…',
    'account.deleteFailed': 'Nie udało się usunąć konta: {msg}',
  },
};

let current = DEFAULT_LANGUAGE;

export const getLanguage = () => current;
export function setLanguage(code) {
  current = MESSAGES[code] ? code : DEFAULT_LANGUAGE;
  return current;
}

const fill = (str, vars) =>
  vars ? str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : str;

// Translate `key` in the current language, falling back to English, then to the
// raw key (so a missing string is visible rather than blank), with {var} fills.
export function t(key, vars) {
  const str = MESSAGES[current]?.[key] ?? MESSAGES[DEFAULT_LANGUAGE][key] ?? key;
  return fill(str, vars);
}

// Translate every tagged node under `root`: text via [data-i18n], and the
// title / placeholder / aria-label attributes via their data-i18n-* variants.
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of root.querySelectorAll('[data-i18n-aria-label]'))
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
}
