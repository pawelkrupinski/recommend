package pl.filmowo.ui.common

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.SubcomposeAsyncImage
import pl.filmowo.model.Pick
import pl.filmowo.ui.theme.Accent
import pl.filmowo.ui.theme.ImdbYellow
import pl.filmowo.ui.theme.MetaBad
import pl.filmowo.ui.theme.MetaGood
import pl.filmowo.ui.theme.MetaMid
import pl.filmowo.ui.theme.Panel2
import pl.filmowo.ui.theme.TextMuted

private const val TMDB_IMG = "https://image.tmdb.org/t/p"

/** A TMDB image URL at the given size (e.g. "w342" posters, "w45" logos), or null. */
fun tmdbImage(path: String?, size: String): String? =
    if (path.isNullOrBlank()) null else "$TMDB_IMG/$size$path"

/** Poster in a 2:3 box, cropped, with a film-strip placeholder while loading/absent. */
@Composable
fun PosterImage(path: String?, modifier: Modifier = Modifier) {
    Box(modifier = modifier.background(Panel2), contentAlignment = Alignment.Center) {
        val url = tmdbImage(path, "w342")
        if (url == null) {
            PlaceholderGlyph()
        } else {
            SubcomposeAsyncImage(
                model = url,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
                loading = { PlaceholderGlyph() },
                error = { PlaceholderGlyph() },
            )
        }
    }
}

@Composable
private fun PlaceholderGlyph() {
    Icon(
        imageVector = Icons.Outlined.Movie,
        contentDescription = null,
        tint = TextMuted.copy(alpha = 0.35f),
        modifier = Modifier.fillMaxSize(0.3f),
    )
}

/** Ten tap-to-rate stars (1–10 → the web's rating/10). Tapping a star commits it. */
@Composable
fun RateStars(onRate: (Int) -> Unit, modifier: Modifier = Modifier, filledUpTo: Int = 0) {
    Row(modifier = modifier, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        for (n in 1..10) {
            Icon(
                imageVector = if (n <= filledUpTo) Icons.Filled.Star else Icons.Outlined.StarBorder,
                contentDescription = "Rate $n",
                tint = if (n <= filledUpTo) Accent else TextMuted,
                modifier = Modifier
                    .size(24.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .clickable { onRate(n) },
            )
        }
    }
}

/** IMDb + Metacritic badges, mirroring the web `.rb.imdb` / `.rb.mc` pills. */
@Composable
fun RatingBadges(pick: Pick, modifier: Modifier = Modifier) {
    Row(modifier = modifier, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        pick.imdbRating?.let { Badge("IMDb ${trim1(it)}", ImdbYellow, Color.Black) }
        pick.metascore?.let { Badge("MC $it", metaColor(it), Color.White) }
    }
}

@Composable
private fun Badge(text: String, bg: Color, fg: Color) {
    Text(
        text = text,
        color = fg,
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier
            .clip(RoundedCornerShape(4.dp))
            .background(bg)
            .padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

private fun metaColor(score: Int): Color = when {
    score >= 61 -> MetaGood
    score >= 40 -> MetaMid
    else -> MetaBad
}

private fun trim1(v: Double): String = if (v == v.toLong().toDouble()) v.toLong().toString() else "%.1f".format(v)

/** Open an external URL (streaming link, trailer, credit). No-op on bad URLs. */
fun openUrl(context: Context, url: String?) {
    if (url.isNullOrBlank()) return
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    } catch (_: ActivityNotFoundException) {
    } catch (_: Exception) {
    }
}

@Composable
fun rememberContext(): Context = LocalContext.current
