package pl.filmowo.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "filmowo_prefs")

/** The device-local language cache the view model writes to, as an abstraction so
 *  it never touches a real DataStore in tests (a boring fake stands in). */
interface LanguageStore {
    suspend fun setLanguage(code: String)
}

/**
 * The sliver of device-local state the app keeps outside the server. The server
 * is authoritative for settings, ratings, and the watchlist; DataStore just
 * caches the last-known UI language so the first frame after a cold start (and
 * any offline launch) localizes correctly before `/api/me` returns.
 */
class UserPreferences(private val context: Context) : LanguageStore {

    val language: Flow<String?> = context.dataStore.data.map { it[KEY_LANGUAGE] }

    override suspend fun setLanguage(code: String) {
        context.dataStore.edit { it[KEY_LANGUAGE] = code }
    }

    private companion object {
        val KEY_LANGUAGE = stringPreferencesKey("language")
    }
}
