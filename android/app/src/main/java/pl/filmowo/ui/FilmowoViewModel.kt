package pl.filmowo.ui

import android.content.Context
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import pl.filmowo.auth.SessionAuth
import pl.filmowo.data.LanguageStore
import pl.filmowo.model.Genre
import pl.filmowo.model.Me
import pl.filmowo.model.Pick
import pl.filmowo.model.RateQueueItem
import pl.filmowo.model.Rating
import pl.filmowo.model.Service
import pl.filmowo.model.Tone
import pl.filmowo.model.WhereInfo
import pl.filmowo.net.FilmowoApi
import pl.filmowo.net.SettingsPayload

private const val RATE_GOAL = 10

// Sentinel for DiscoverState.error — the UI maps it to a localized "couldn't
// reach the server" message with a Retry button (see DiscoverScreen).
const val LOAD_ERROR = "load_error"

/** Discover is adaptive: a rate-queue until the goal, then personalized picks. */
enum class DiscoverMode { LOADING, ONBOARDING, PICKS }

data class DiscoverState(
    val mode: DiscoverMode = DiscoverMode.LOADING,
    val queue: List<RateQueueItem> = emptyList(),
    val ratedCount: Int = 0,
    val goal: Int = RATE_GOAL,
    val picks: List<Pick> = emptyList(),
    val type: String = "",   // "", "movie", "tv"
    val genre: String = "",  // genre name
    val tone: String = "",   // tone slug
    val loading: Boolean = false,
    val error: String? = null,
)

data class WatchlistState(
    val items: List<Pick> = emptyList(),
    val sort: String = "added", // "added" | "rating"
    val loading: Boolean = false,
)

/** The open where-to-watch sheet. `fromWatchlist` enables the rate-to-remove flow. */
data class DetailState(
    val pick: Pick,
    val where: WhereInfo? = null,
    val loading: Boolean = true,
    val fromWatchlist: Boolean = false,
)

/** Reference + async data the Settings screen needs. */
data class SettingsData(
    val services: List<Service> = emptyList(),
    val loadingServices: Boolean = false,
)

/**
 * The single app view model (the movies app's convention: MVVM + manual DI, no
 * framework). Holds each tab's state as a [StateFlow] and drives every action
 * through [FilmowoApi] / [AuthRepository]. Optimistic where it helps: a rated,
 * dismissed, or saved card leaves the grid immediately, the write rides behind.
 */
class FilmowoViewModel(
    private val api: FilmowoApi,
    private val auth: SessionAuth,
    private val prefs: LanguageStore,
) : ViewModel() {

    private val _me = MutableStateFlow<Me?>(null)
    val me: StateFlow<Me?> = _me.asStateFlow()

    private val _discover = MutableStateFlow(DiscoverState())
    val discover: StateFlow<DiscoverState> = _discover.asStateFlow()

    private val _watchlist = MutableStateFlow(WatchlistState())
    val watchlist: StateFlow<WatchlistState> = _watchlist.asStateFlow()

    private val _ratings = MutableStateFlow<List<Rating>>(emptyList())
    val ratings: StateFlow<List<Rating>> = _ratings.asStateFlow()

    private val _genres = MutableStateFlow<List<Genre>>(emptyList())
    val genres: StateFlow<List<Genre>> = _genres.asStateFlow()

    private val _tones = MutableStateFlow<List<Tone>>(emptyList())
    val tones: StateFlow<List<Tone>> = _tones.asStateFlow()

    private val _detail = MutableStateFlow<DetailState?>(null)
    val detail: StateFlow<DetailState?> = _detail.asStateFlow()

    private val _settings = MutableStateFlow(SettingsData())
    val settings: StateFlow<SettingsData> = _settings.asStateFlow()

    private val _toast = MutableStateFlow<String?>(null)
    val toast: StateFlow<String?> = _toast.asStateFlow()

    // True when the very first /api/me failed and there's no account yet, so the
    // app can show an error+retry screen instead of hanging on the boot spinner.
    private val _bootFailed = MutableStateFlow(false)
    val bootFailed: StateFlow<Boolean> = _bootFailed.asStateFlow()

    // The exact reason the boot /api/me probe failed (exception class + message),
    // surfaced under the error screen so a field failure is self-diagnosing.
    private val _bootError = MutableStateFlow<String?>(null)
    val bootError: StateFlow<String?> = _bootError.asStateFlow()

    private var queuePage = 1

    init {
        refreshAll()
    }

    /** Boot / post-auth: reload the account, then everything keyed to it. If
     *  /api/me can't be reached and we have no account yet, surface a boot error
     *  (a later refresh failure keeps the already-loaded app up instead). */
    fun refreshAll() {
        viewModelScope.launch {
            val loaded = runCatching { api.me() }
                .onFailure {
                    Log.w("Filmowo", "boot /api/me failed: ${it.javaClass.simpleName}: ${it.message}", it)
                    _bootError.value = "${it.javaClass.simpleName}: ${it.message}"
                }
                .getOrNull()
            if (loaded != null) {
                _me.value = loaded
                _bootFailed.value = false
                _bootError.value = null
                prefs.setLanguage(loaded.language)
                loadGenres()
                loadTones()
                loadDiscover()
                loadWatchlist()
                loadRatings()
            } else if (_me.value == null) {
                _bootFailed.value = true
            }
        }
    }

    // ---- discover ----------------------------------------------------------
    fun loadDiscover(refresh: Boolean = false) {
        viewModelScope.launch {
            _discover.update { it.copy(loading = true, error = null) }
            // Once in picks mode the rate goal is met for good (ratings only grow),
            // so skip the extra /api/ratings round-trip on filter changes / refreshes.
            val ratedCount = if (_discover.value.mode == DiscoverMode.PICKS) {
                _discover.value.ratedCount
            } else {
                runCatching { api.ratings().ratings.size }.getOrElse {
                    _discover.update { it.copy(loading = false, error = LOAD_ERROR) }
                    return@launch
                }
            }
            if (ratedCount < RATE_GOAL) {
                queuePage = 1
                val items = runCatching { api.rateQueue(queuePage).items }.getOrElse {
                    _discover.update { it.copy(loading = false, error = LOAD_ERROR) }
                    return@launch
                }
                _discover.update {
                    it.copy(mode = DiscoverMode.ONBOARDING, queue = items, ratedCount = ratedCount, loading = false)
                }
            } else {
                loadPicks(refresh, ratedCount)
            }
        }
    }

    private suspend fun loadPicks(refresh: Boolean, ratedCount: Int) {
        val s = _discover.value
        val params = buildMap {
            if (s.type.isNotEmpty()) put("type", s.type)
            if (s.genre.isNotEmpty()) put("genre", s.genre)
            if (s.tone.isNotEmpty()) put("tag", s.tone)
            if (refresh) put("refresh", "1")
        }
        val picks = runCatching { api.recommend(params).results }.getOrElse {
            _discover.update { it.copy(loading = false, error = LOAD_ERROR) }
            return
        }
        _discover.update {
            it.copy(mode = DiscoverMode.PICKS, picks = picks, ratedCount = ratedCount, loading = false, error = null)
        }
        enrichPicks(picks)
    }

    /** Fill in IMDb/Metacritic badges + tones after first paint (NDJSON stream). */
    private fun enrichPicks(picks: List<Pick>) {
        val ids = picks.map { it.key }
        if (ids.isEmpty()) return
        viewModelScope.launch {
            val rows = runCatching { api.enrich(ids) }.getOrDefault(emptyList())
            if (rows.isEmpty()) return@launch
            val byKey = rows.associateBy { it.key }
            _discover.update { st ->
                st.copy(picks = st.picks.map { p ->
                    byKey[p.key]?.let { e ->
                        p.copy(
                            imdbRating = e.imdbRating ?: p.imdbRating,
                            metascore = e.metascore ?: p.metascore,
                            imdbId = e.imdbId ?: p.imdbId,
                            tones = if (e.tones.isNotEmpty()) e.tones else p.tones,
                        )
                    } ?: p
                })
            }
        }
    }

    // Optimistically narrow the already-loaded picks by media type so the switch
    // feels instant (the type-scoped server pool — a possibly-slow cold build —
    // then replaces them with a fuller set in the background via loadDiscover).
    fun setType(type: String) {
        _discover.update {
            it.copy(type = type, picks = it.picks.filter { p -> type.isEmpty() || p.mediaType == type })
        }
        loadDiscover()
    }
    fun setGenre(genre: String) { _discover.update { it.copy(genre = genre) }; loadDiscover() }
    fun setTone(tone: String) { _discover.update { it.copy(tone = tone) }; loadDiscover() }

    fun ratePick(pick: Pick, star: Int) {
        removeFromDiscover(pick)
        viewModelScope.launch {
            runCatching { api.rate(pick.tmdbId, pick.mediaType, star, pick.title, pick.year) }
            loadRatings()
        }
    }

    fun dismissPick(pick: Pick) {
        removeFromDiscover(pick)
        viewModelScope.launch { runCatching { api.dismiss(pick.tmdbId, pick.mediaType) } }
    }

    fun savePick(pick: Pick) {
        removeFromDiscover(pick)
        viewModelScope.launch {
            runCatching { api.saveToWatchlist(pick) }
            loadWatchlist()
        }
    }

    private fun removeFromDiscover(pick: Pick) {
        _discover.update { it.copy(picks = it.picks.filterNot { p -> p.key == pick.key }) }
    }

    // ---- onboarding rate queue --------------------------------------------
    fun rateQueueItem(item: RateQueueItem, star: Int) {
        advanceQueue(item)
        viewModelScope.launch {
            runCatching { api.rate(item.tmdbId, "movie", star, item.title, item.year) }
            bumpRatedCount()
        }
    }

    fun skipQueueItem(item: RateQueueItem) {
        advanceQueue(item)
        viewModelScope.launch { runCatching { api.notSeen(item.tmdbId, "movie") } }
    }

    private fun advanceQueue(item: RateQueueItem) {
        _discover.update { it.copy(queue = it.queue.filterNot { q -> q.tmdbId == item.tmdbId }) }
        // Top the queue up when it runs low so onboarding never stalls.
        if (_discover.value.queue.size < 5) {
            viewModelScope.launch {
                queuePage++
                val more = runCatching { api.rateQueue(queuePage).items }.getOrDefault(emptyList())
                _discover.update { it.copy(queue = it.queue + more.filter { m -> it.queue.none { q -> q.tmdbId == m.tmdbId } }) }
            }
        }
    }

    private fun bumpRatedCount() {
        val next = _discover.value.ratedCount + 1
        _discover.update { it.copy(ratedCount = next) }
        if (next >= RATE_GOAL) loadDiscover() // goal reached → swap to picks
    }

    // ---- detail / where-to-watch ------------------------------------------
    fun openDetail(pick: Pick, fromWatchlist: Boolean = false) {
        _detail.value = DetailState(pick = pick, loading = true, fromWatchlist = fromWatchlist)
        viewModelScope.launch {
            val region = _me.value?.country
            val services = _me.value?.services ?: emptyList()
            val where = runCatching { api.where(pick.tmdbId, pick.mediaType, region, services) }.getOrNull()
            _detail.update { it?.copy(where = where, loading = false) }
        }
    }

    fun closeDetail() { _detail.value = null }

    /** Rate the open title; from the watchlist this also drops it from the list. */
    fun rateFromDetail(star: Int) {
        val d = _detail.value ?: return
        val pick = d.pick
        closeDetail()
        viewModelScope.launch {
            runCatching { api.rate(pick.tmdbId, pick.mediaType, star, pick.title, pick.year) }
            if (d.fromWatchlist) {
                runCatching { api.removeFromWatchlist(pick.tmdbId, pick.mediaType) }
                loadWatchlist()
            }
            loadRatings()
        }
    }

    // ---- watchlist ---------------------------------------------------------
    fun loadWatchlist() {
        viewModelScope.launch {
            _watchlist.update { it.copy(loading = true) }
            val items = runCatching { api.watchlist().watchlist }
                .onFailure { Log.w("Filmowo", "watchlist fetch failed: ${it.javaClass.simpleName}: ${it.message}") }
                .getOrDefault(emptyList())
            Log.i("Filmowo", "watchlist fetched ${items.size} items")
            _watchlist.update { it.copy(items = sortWatchlist(items, it.sort), loading = false) }
        }
    }

    fun setWatchlistSort(sort: String) {
        _watchlist.update { it.copy(sort = sort, items = sortWatchlist(it.items, sort)) }
        viewModelScope.launch { runCatching { api.saveSettings(SettingsPayload(watchlistSort = sort)) } }
    }

    fun removeFromWatchlist(pick: Pick) {
        _watchlist.update { it.copy(items = it.items.filterNot { p -> p.key == pick.key }) }
        viewModelScope.launch {
            runCatching { api.removeFromWatchlist(pick.tmdbId, pick.mediaType) }
            loadWatchlist() // re-sync with the server after the mutation lands
        }
    }

    private fun sortWatchlist(items: List<Pick>, sort: String): List<Pick> =
        if (sort == "rating") items.sortedByDescending { it.score ?: it.voteAverage ?: 0.0 } else items

    // ---- ratings -----------------------------------------------------------
    fun loadRatings() {
        viewModelScope.launch {
            _ratings.value = runCatching { api.ratings().ratings }.getOrDefault(emptyList())
        }
    }

    fun deleteRating(rating: Rating) {
        _ratings.update { list -> list.filterNot { it.tmdbId == rating.tmdbId && it.mediaType == rating.mediaType } }
        viewModelScope.launch {
            runCatching { api.deleteRating(rating.tmdbId, rating.mediaType) }
        }
    }

    // ---- settings ----------------------------------------------------------
    private fun loadGenres() {
        viewModelScope.launch { _genres.value = runCatching { api.genres().genres }.getOrDefault(emptyList()) }
    }

    private fun loadTones() {
        viewModelScope.launch { _tones.value = runCatching { api.tones().tones }.getOrDefault(emptyList()) }
    }

    fun loadServices() {
        val region = _me.value?.country ?: "PL"
        viewModelScope.launch {
            _settings.update { it.copy(loadingServices = true) }
            val list = runCatching { api.providers(region).providers }.getOrDefault(emptyList())
            _settings.update { it.copy(services = list, loadingServices = false) }
        }
    }

    fun setCountry(country: String) {
        viewModelScope.launch {
            runCatching { api.saveSettings(SettingsPayload(country = country)) }
            refreshAll()
            loadServices()
        }
    }

    fun setLanguage(language: String) {
        viewModelScope.launch {
            runCatching { api.saveSettings(SettingsPayload(language = language)) }
            prefs.setLanguage(language)
            refreshAll()
        }
    }

    fun toggleService(id: Int) {
        val current = _me.value?.services ?: emptyList()
        val next = if (id in current) current - id else current + id
        _me.update { it?.copy(services = next) }
        viewModelScope.launch {
            runCatching { api.saveSettings(SettingsPayload(providers = next)) }
            loadDiscover()
        }
    }

    fun completeOnboarding() {
        viewModelScope.launch {
            runCatching { api.saveSettings(SettingsPayload(onboarded = true)) }
            refreshAll()
        }
    }

    // ---- auth --------------------------------------------------------------
    fun signIn(context: Context, provider: String) = auth.startWebSignIn(context, provider)

    /** Called from MainActivity when the filmowo://auth-done deep link arrives. */
    fun handleAuthRedirect(code: String) {
        viewModelScope.launch {
            if (auth.exchangeCode(code)) refreshAll() else _toast.value = "Sign-in failed"
        }
    }

    fun signOut() {
        viewModelScope.launch { auth.signOut(); refreshAll() }
    }

    fun deleteAccount() {
        viewModelScope.launch { auth.deleteAccount(); refreshAll() }
    }

    fun consumeToast() { _toast.value = null }

    /** Manual DI factory (the movies app's pattern — no DI framework). */
    class Factory(
        private val api: FilmowoApi,
        private val auth: SessionAuth,
        private val prefs: LanguageStore,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            FilmowoViewModel(api, auth, prefs) as T
    }
}
