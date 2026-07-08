package pl.filmowo.ui.detail

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pl.filmowo.i18n.t
import pl.filmowo.model.Pick
import pl.filmowo.model.WhereInfo
import pl.filmowo.ui.DetailState
import pl.filmowo.ui.common.PosterImage
import pl.filmowo.ui.common.RateStars
import pl.filmowo.ui.common.RatingBadges
import pl.filmowo.ui.common.openInStreamingApp
import pl.filmowo.ui.common.openUrl
import pl.filmowo.ui.theme.Link
import pl.filmowo.ui.theme.TextMuted

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun DetailSheet(detail: DetailState, onClose: () -> Unit, onRate: (Int) -> Unit) {
    val context = LocalContext.current
    val pick = detail.pick
    ModalBottomSheet(onDismissRequest = onClose) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                PosterImage(
                    pick.posterPath,
                    modifier = Modifier.size(width = 120.dp, height = 180.dp).clip(RoundedCornerShape(8.dp)),
                )
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(pick.title, fontWeight = FontWeight.Bold, fontSize = 20.sp)
                    val meta = listOfNotNull(pick.year?.toString(), pick.runtime?.let { "${it}m" }).joinToString(" · ")
                    if (meta.isNotEmpty()) Text(meta, color = TextMuted, fontSize = 13.sp)
                    RatingBadges(pick)
                    pick.director?.let { Labeled(t("detail.director"), it) }
                    if (pick.cast.isNotEmpty()) Labeled(t("detail.cast"), pick.cast.take(4).joinToString(", "))
                }
            }

            if (pick.tones.isNotEmpty()) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    pick.tones.forEach { SuggestionChip(onClick = {}, label = { Text(it.label, fontSize = 12.sp) }) }
                }
            }

            pick.overview?.takeIf { it.isNotBlank() }?.let { Text(it, color = TextMuted, fontSize = 14.sp) }

            HorizontalDivider()
            Text(t("detail.whereToWatch"), fontWeight = FontWeight.SemiBold)
            WhereLinks(detail.loading, detail.where, pick, context)

            if (pick.trailers.isNotEmpty()) {
                pick.trailers.forEach { tr ->
                    Text(
                        "▶ ${tr.name ?: t("detail.trailer")}",
                        color = Link,
                        modifier = Modifier.clickable { openUrl(context, "https://youtu.be/${tr.key}") },
                    )
                }
            }

            if (detail.fromWatchlist) {
                HorizontalDivider()
                Text(t("detail.watchedRate"), color = TextMuted, fontSize = 13.sp)
                RateStars(onRate = onRate)
            }
        }
    }
}

@Composable
private fun WhereLinks(loading: Boolean, where: WhereInfo?, pick: Pick, context: android.content.Context) {
    if (loading) {
        CircularProgressIndicator(modifier = Modifier.size(24.dp))
        return
    }
    val links = where?.deepLinks ?: emptyList()
    val flat = where?.flatrate ?: emptyList()
    val tmdbLink = where?.tmdbLink
    if (links.isNotEmpty()) {
        links.forEach { dl ->
            Text(
                "▶ ${dl.service}${dl.type?.let { " · $it" } ?: ""}",
                color = Link,
                modifier = Modifier.fillMaxWidth().clickable { openInStreamingApp(context, dl.link, dl.androidPackage) }.padding(vertical = 4.dp),
            )
        }
    } else if (flat.isNotEmpty()) {
        flat.forEach { f ->
            Text(f.name, modifier = Modifier.fillMaxWidth().clickable { openUrl(context, tmdbLink) }.padding(vertical = 4.dp))
        }
    } else {
        Text(t("detail.notAvailable"), color = TextMuted, fontSize = 13.sp)
    }
}

@Composable
private fun Labeled(label: String, value: String) {
    Text(
        buildString { append(label); append(": "); append(value) },
        color = TextMuted,
        fontSize = 12.sp,
    )
}
