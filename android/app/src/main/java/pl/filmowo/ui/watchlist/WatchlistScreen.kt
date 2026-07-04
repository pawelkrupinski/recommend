package pl.filmowo.ui.watchlist

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pl.filmowo.i18n.t
import pl.filmowo.model.Pick
import pl.filmowo.ui.WatchlistState
import pl.filmowo.ui.common.PosterImage
import pl.filmowo.ui.common.RatingBadges
import pl.filmowo.ui.theme.TextMuted

@Composable
fun WatchlistScreen(
    state: WatchlistState,
    onOpen: (Pick) -> Unit,
    onRemove: (Pick) -> Unit,
    onSort: (String) -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(t("watchlist.count", mapOf("n" to state.items.size.toString())), color = TextMuted, fontSize = 13.sp)
            SortDropdown(state.sort, onSort)
        }
        if (state.items.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(t("watchlist.empty"), color = TextMuted, modifier = Modifier.padding(24.dp))
            }
        } else {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(170.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                items(state.items, key = { it.key }) { pick ->
                    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        PosterImage(
                            pick.posterPath,
                            modifier = Modifier.fillMaxWidth().aspectRatio(2f / 3f)
                                .clip(RoundedCornerShape(10.dp)).clickable { onOpen(pick) },
                        )
                        Text("${pick.title} ${pick.year ?: ""}", fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 2)
                        RatingBadges(pick)
                        OutlinedButton(onClick = { onRemove(pick) }, modifier = Modifier.fillMaxWidth()) {
                            Text(t("watchlist.remove"), fontSize = 12.sp)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SortDropdown(sort: String, onSort: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val label = if (sort == "rating") t("watchlist.sortRating") else t("watchlist.sortAdded")
    Box {
        TextButton(onClick = { open = true }) { Text(label, fontSize = 12.sp) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text(t("watchlist.sortAdded")) }, onClick = { open = false; onSort("added") })
            DropdownMenuItem(text = { Text(t("watchlist.sortRating")) }, onClick = { open = false; onSort("rating") })
        }
    }
}
