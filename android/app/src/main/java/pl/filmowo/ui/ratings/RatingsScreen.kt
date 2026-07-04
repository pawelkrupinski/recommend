package pl.filmowo.ui.ratings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pl.filmowo.i18n.t
import pl.filmowo.model.Rating
import pl.filmowo.ui.theme.Accent
import pl.filmowo.ui.theme.TextMuted

@Composable
fun RatingsScreen(ratings: List<Rating>, onDelete: (Rating) -> Unit) {
    if (ratings.isEmpty()) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(t("ratings.empty"), color = TextMuted, modifier = Modifier.padding(24.dp))
        }
        return
    }
    Column(Modifier.fillMaxSize()) {
        Text(
            t("ratings.count", mapOf("n" to ratings.size.toString())),
            color = TextMuted, fontSize = 13.sp,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
        )
        LazyColumn(Modifier.fillMaxSize()) {
            items(ratings, key = { "${it.mediaType}:${it.tmdbId}" }) { r ->
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(r.title ?: r.tmdbId.toString(), fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1)
                        Text("${r.year ?: ""} · ${r.source ?: ""}", color = TextMuted, fontSize = 12.sp)
                    }
                    Text("${fmt(r.rating)}/10", color = Accent, fontWeight = FontWeight.Bold)
                    IconButton(onClick = { onDelete(r) }) {
                        Icon(Icons.Filled.Close, contentDescription = "Delete", tint = TextMuted)
                    }
                }
                HorizontalDivider(color = pl.filmowo.ui.theme.Line)
            }
        }
    }
}

private fun fmt(v: Double): String = if (v == v.toLong().toDouble()) v.toLong().toString() else "%.1f".format(v)
