package pl.filmowo.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "filmowo_prefs")

/** The device-local preferences the view model reads/writes, as an abstraction so
 *  it never touches a real DataStore in tests (a boring fake stands in). */
interface AppPreferences {
    suspend fun setLanguage(code: String)
    /** The remembered watchlist sort ("added" | "rating"), or null until first set. */
    val watchlistSort: Flow<String?>
    suspend fun setWatchlistSort(sort: String)
}

/**
 * Device-local state kept outside the server. The server is authoritative for
 * settings, ratings, and the watchlist; DataStore caches the last-known UI
 * language (so the first frame localizes before `/api/me` returns) and remembers
 * the watchlist sort locally — a pure display choice that isn't worth a server
 * round-trip, so it never syncs.
 */
class UserPreferences(private val context: Context) : AppPreferences {

    val language: Flow<String?> = context.dataStore.data.map { it[KEY_LANGUAGE] }

    override suspend fun setLanguage(code: String) {
        context.dataStore.edit { it[KEY_LANGUAGE] = code }
    }

    override val watchlistSort: Flow<String?> = context.dataStore.data.map { it[KEY_WATCHLIST_SORT] }

    override suspend fun setWatchlistSort(sort: String) {
        context.dataStore.edit { it[KEY_WATCHLIST_SORT] = sort }
    }

    private companion object {
        val KEY_LANGUAGE = stringPreferencesKey("language")
        val KEY_WATCHLIST_SORT = stringPreferencesKey("watchlistSort")
    }
}
