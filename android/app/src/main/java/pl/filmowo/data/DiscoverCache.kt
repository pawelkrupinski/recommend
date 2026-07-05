package pl.filmowo.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import pl.filmowo.model.Pick

/** A cached Discover response: the server ETag it was fetched with, plus the picks. */
data class CachedDiscover(val etag: String, val picks: List<Pick>)

/**
 * A device-local cache of the Discover picks, keyed by the filter combo (type ·
 * genre · tone). It lets the app paint the last-known picks instantly instead of
 * waiting on the slow server rebuild, and — via the stored ETag — revalidate with
 * a conditional request so the picks are only replaced when the server's actually
 * changed. An abstraction so the view model never touches a real DataStore in
 * tests (a boring in-memory fake stands in).
 */
interface DiscoverCache {
    suspend fun get(key: String): CachedDiscover?
    suspend fun put(key: String, etag: String, picks: List<Pick>)
}

private val Context.discoverDataStore by preferencesDataStore(name = "filmowo_discover")

/**
 * The DataStore-backed cache: the whole keyed map is serialized to one JSON blob
 * (small — a screenful of picks per filter combo). Bounded to [MAX_ENTRIES],
 * evicting the least-recently-written combo, so a user who tries many filters
 * can't grow it without limit.
 */
class DataStoreDiscoverCache(private val context: Context) : DiscoverCache {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = false }

    @Serializable
    private data class Entry(val etag: String, val picks: List<Pick>)

    override suspend fun get(key: String): CachedDiscover? {
        val entry = load()[key] ?: return null
        return CachedDiscover(entry.etag, entry.picks)
    }

    override suspend fun put(key: String, etag: String, picks: List<Pick>) {
        // Rebuild insertion-ordered so a re-written key moves to newest, then trim
        // the oldest beyond the cap — a plain LRU by write time.
        val next = LinkedHashMap(load())
        next.remove(key)
        next[key] = Entry(etag, picks)
        while (next.size > MAX_ENTRIES) next.remove(next.keys.first())
        context.discoverDataStore.edit { it[KEY] = json.encodeToString(next as Map<String, Entry>) }
    }

    private suspend fun load(): Map<String, Entry> {
        val raw = context.discoverDataStore.data.firstOrNull()?.get(KEY) ?: return emptyMap()
        return runCatching { json.decodeFromString<Map<String, Entry>>(raw) }.getOrDefault(emptyMap())
    }

    private companion object {
        val KEY = stringPreferencesKey("discoverCache")
        const val MAX_ENTRIES = 8
    }
}
