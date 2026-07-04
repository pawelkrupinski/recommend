package pl.filmowo.ui.discover

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pl.filmowo.i18n.t
import pl.filmowo.model.Genre
import pl.filmowo.model.Pick
import pl.filmowo.model.RateQueueItem
import pl.filmowo.model.Tone
import pl.filmowo.ui.DiscoverMode
import pl.filmowo.ui.DiscoverState
import pl.filmowo.ui.common.PosterImage
import pl.filmowo.ui.common.SelectableMenuItem
import pl.filmowo.ui.common.RateStars
import pl.filmowo.ui.common.RatingBadges
import pl.filmowo.ui.theme.Line
import pl.filmowo.ui.theme.Panel
import pl.filmowo.ui.theme.TextMuted

@Composable
fun DiscoverScreen(
    state: DiscoverState,
    genres: List<Genre>,
    tones: List<Tone>,
    onType: (String) -> Unit,
    onGenre: (String) -> Unit,
    onTone: (String) -> Unit,
    onRefresh: () -> Unit,
    onOpen: (Pick) -> Unit,
    onRatePick: (Pick, Int) -> Unit,
    onSave: (Pick) -> Unit,
    onDismiss: (Pick) -> Unit,
    onRateQueue: (RateQueueItem, Int) -> Unit,
    onSkipQueue: (RateQueueItem) -> Unit,
) {
    when (state.mode) {
        DiscoverMode.LOADING -> Centered { CircularProgressIndicator() }
        DiscoverMode.ONBOARDING -> OnboardingQueue(state, onRateQueue, onSkipQueue)
        DiscoverMode.PICKS -> Picks(state, genres, tones, onType, onGenre, onTone, onRefresh, onOpen, onRatePick, onSave, onDismiss)
    }
}

@Composable
private fun OnboardingQueue(
    state: DiscoverState,
    onRate: (RateQueueItem, Int) -> Unit,
    onSkip: (RateQueueItem) -> Unit,
) {
    val item = state.queue.firstOrNull()
    if (item == null) {
        Centered { CircularProgressIndicator() }
        return
    }
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
    ) {
        Text(
            t("discover.rateMore", mapOf("n" to (state.goal - state.ratedCount).coerceAtLeast(1).toString())),
            color = TextMuted,
            fontSize = 14.sp,
        )
        PosterImage(
            item.posterPath,
            modifier = Modifier.widthIn(max = 240.dp).aspectRatio(2f / 3f).clip(RoundedCornerShape(10.dp)),
        )
        Text("${item.title} ${item.year ?: ""}", fontWeight = FontWeight.SemiBold, fontSize = 18.sp)
        RateStars(onRate = { star -> onRate(item, star) })
        TextButton(onClick = { onSkip(item) }) { Text(t("card.notSeen")) }
    }
}

@Composable
private fun Picks(
    state: DiscoverState,
    genres: List<Genre>,
    tones: List<Tone>,
    onType: (String) -> Unit,
    onGenre: (String) -> Unit,
    onTone: (String) -> Unit,
    onRefresh: () -> Unit,
    onOpen: (Pick) -> Unit,
    onRatePick: (Pick, Int) -> Unit,
    onSave: (Pick) -> Unit,
    onDismiss: (Pick) -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        FilterBar(state, genres, tones, onType, onGenre, onTone, onRefresh)
        when {
            state.loading && state.picks.isEmpty() -> Centered { CircularProgressIndicator() }
            state.picks.isEmpty() ->
                Centered { Text(t("discover.empty"), color = TextMuted, modifier = Modifier.padding(24.dp)) }
            else -> PicksGrid(state, onOpen, onRatePick, onSave, onDismiss, onRefresh)
        }
    }
}

// The picks grid with drag-down-to-refresh (the spinner also shows while a
// filter change or the Refresh button is loading, since both set state.loading).
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PicksGrid(
    state: DiscoverState,
    onOpen: (Pick) -> Unit,
    onRatePick: (Pick, Int) -> Unit,
    onSave: (Pick) -> Unit,
    onDismiss: (Pick) -> Unit,
    onRefresh: () -> Unit,
) {
    PullToRefreshBox(
        isRefreshing = state.loading,
        onRefresh = onRefresh,
        modifier = Modifier.fillMaxSize(),
    ) {
        LazyVerticalGrid(
            columns = GridCells.Adaptive(170.dp),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            items(state.picks, key = { it.key }) { pick ->
                PickCard(pick, onOpen, onRatePick, onSave, onDismiss)
            }
        }
    }
}

@Composable
private fun PickCard(
    pick: Pick,
    onOpen: (Pick) -> Unit,
    onRate: (Pick, Int) -> Unit,
    onSave: (Pick) -> Unit,
    onDismiss: (Pick) -> Unit,
) {
    Column(
        Modifier.clip(RoundedCornerShape(10.dp)).fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Box {
            PosterImage(
                pick.posterPath,
                modifier = Modifier.fillMaxWidth().aspectRatio(2f / 3f)
                    .clip(RoundedCornerShape(10.dp))
                    .clickable { onOpen(pick) },
            )
            // The web's .watch-btn: a 30dp dark-translucent circle with a white
            // "+" and a thin border, tucked into the poster's top-right corner.
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(8.dp)
                    .size(30.dp)
                    .clip(CircleShape)
                    .background(Color.Black.copy(alpha = 0.78f))
                    .border(1.dp, Line, CircleShape)
                    .clickable { onSave(pick) },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.Add,
                    contentDescription = t("card.save"),
                    tint = Color.White,
                    modifier = Modifier.size(18.dp),
                )
            }
        }
        Text("${pick.title} ${pick.year ?: ""}", fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 2)
        RatingBadges(pick)
        RateStars(onRate = { star -> onRate(pick, star) })
        OutlinedButton(onClick = { onDismiss(pick) }, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Filled.Close, contentDescription = null, modifier = Modifier.padding(end = 4.dp))
            Text(t("card.notInterested"), fontSize = 12.sp)
        }
    }
}

@Composable
private fun FilterBar(
    state: DiscoverState,
    genres: List<Genre>,
    tones: List<Tone>,
    onType: (String) -> Unit,
    onGenre: (String) -> Unit,
    onTone: (String) -> Unit,
    onRefresh: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FilterDropdown(
            current = typeLabel(state.type),
            selected = state.type,
            options = listOf("" to t("filter.allTypes"), "movie" to t("filter.movie"), "tv" to t("filter.tv")),
            onSelect = onType,
        )
        FilterDropdown(
            current = state.genre.ifEmpty { t("filter.allGenres") },
            selected = state.genre,
            options = listOf("" to t("filter.allGenres")) + genres.map { it.name to it.name },
            onSelect = onGenre,
        )
        FilterDropdown(
            current = tones.firstOrNull { it.slug == state.tone }?.label ?: t("filter.allTones"),
            selected = state.tone,
            options = listOf("" to t("filter.allTones")) + tones.map { it.slug to it.label },
            onSelect = onTone,
        )
        TextButton(onClick = onRefresh, enabled = !state.loading) {
            if (state.loading) {
                CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
            } else {
                Text(t("discover.refresh"), fontSize = 12.sp)
            }
        }
    }
}

@Composable
private fun typeLabel(type: String): String = when (type) {
    "movie" -> t("filter.movie")
    "tv" -> t("filter.tv")
    else -> t("filter.allTypes")
}

@Composable
private fun FilterDropdown(current: String, selected: String, options: List<Pair<String, String>>, onSelect: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        TextButton(onClick = { open = true }) { Text(current, fontSize = 12.sp, maxLines = 1) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (value, label) ->
                SelectableMenuItem(label, selected = value == selected, onClick = { open = false; onSelect(value) })
            }
        }
    }
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { content() }
}
