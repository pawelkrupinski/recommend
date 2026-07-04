package pl.filmowo.ui.common

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.SubcomposeAsyncImage
import pl.filmowo.model.Pick
import pl.filmowo.ui.theme.Accent
import pl.filmowo.ui.theme.CardElevated
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

/**
 * Ten 1–10 rating stars. Tap a star to rate, or — like the web widget — drag
 * horizontally across the row to preview the rating under your finger and lift
 * to commit. A vertical drag is left to the enclosing scroll container.
 */
@Composable
fun RateStars(onRate: (Int) -> Unit, modifier: Modifier = Modifier) {
    var preview by remember { mutableStateOf(0) }
    Row(
        modifier = modifier
            .pointerInput(Unit) {
                detectHorizontalDragGestures(
                    onDragStart = { off -> preview = starAt(off.x, size.width) },
                    onDragEnd = { if (preview > 0) onRate(preview); preview = 0 },
                    onDragCancel = { preview = 0 },
                ) { change, _ -> preview = starAt(change.position.x, size.width) }
            }
            .pointerInput(Unit) {
                detectTapGestures { off -> starAt(off.x, size.width).takeIf { it > 0 }?.let(onRate) }
            },
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        for (n in 1..10) {
            Icon(
                imageVector = if (n <= preview) Icons.Filled.Star else Icons.Outlined.StarBorder,
                contentDescription = "Rate $n",
                tint = if (n <= preview) Accent else TextMuted,
                modifier = Modifier.size(24.dp),
            )
        }
    }
}

/** Which star (1–10) a horizontal offset `x` falls on within a row `width` px
 *  wide; 0 when the finger is off the left edge (clears the preview). */
private fun starAt(x: Float, width: Int): Int {
    if (width <= 0 || x < 0f) return 0
    return ((x / width) * 10f).toInt().coerceIn(0, 9) + 1
}

/**
 * IMDb + Metacritic rating pills, matching the movies (kinowo) Android app: a
 * two-tone IMDb label+value pill (yellow "IMDb" tab + a dark value tab) and a
 * solid Metacritic score pill (just the colour-coded number on the same dark
 * surface). Same trimmed text box, colours, base sizes (11sp / 4dp h-pad /
 * 3dp v-pad / 3dp corner / 4dp gap) and viewport scaling anchored at ~411dp.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RatingBadges(pick: Pick, modifier: Modifier = Modifier) {
    // Pills scale with the phone's width, anchored where the base sizes were
    // tuned (scale 1.0 at ~411dp), clamped so tiny/huge configs stay sensible.
    val scale = (LocalConfiguration.current.screenWidthDp / 411f).coerceIn(0.85f, 1.4f)
    val fontSize = (11f * scale).sp
    val hPad = (4f * scale).dp
    val vPad = (3f * scale).dp
    val corner = (3f * scale).dp
    val gap = (4f * scale).dp
    FlowRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(gap),
        verticalArrangement = Arrangement.spacedBy(gap),
    ) {
        pick.imdbRating?.let { v ->
            LabelValuePill("IMDb", ImdbYellow, Color.Black, oneDecimal(v), ImdbYellow, fontSize, hPad, vPad, corner)
        }
        pick.metascore?.let { v ->
            SinglePill(v.toString(), metaColor(v), fontSize, hPad, vPad, corner)
        }
        // With no ratings yet, reserve exactly one pill's height with an invisible
        // pill, so a still-enriching card stays as tall as its neighbours — keeps
        // side-by-side grid cards the same height (see RatingBadgesTest).
        if (pick.imdbRating == null && pick.metascore == null) {
            SinglePill("0", Color.White, fontSize, hPad, vPad, corner, Modifier.alpha(0f))
        }
    }
}

/** The trimmed text style shared by every pill. `includeFontPadding = false`
 *  drops the extra leading a bare `Text` adds (the Compose cousin of the web's
 *  `text-box-trim`) so the pills don't read tall; the centred line-box trim keeps
 *  the glyphs centred. Mirrors the movies app's `pillTextStyle`. */
private fun pillTextStyle(fontSize: TextUnit, weight: FontWeight) = TextStyle(
    fontSize = fontSize,
    fontWeight = weight,
    platformStyle = PlatformTextStyle(includeFontPadding = false),
    lineHeightStyle = LineHeightStyle(
        alignment = LineHeightStyle.Alignment.Center,
        trim = LineHeightStyle.Trim.Both,
    ),
)

/** Two-tone pill: a solid colour label tab joined to a dark value tab. */
@Composable
private fun LabelValuePill(
    label: String, labelBg: Color, labelFg: Color,
    value: String, valueFg: Color,
    fontSize: TextUnit, hPad: Dp, vPad: Dp, corner: Dp,
) {
    Row(modifier = Modifier.clip(RoundedCornerShape(corner))) {
        Text(
            label, color = labelFg, style = pillTextStyle(fontSize, FontWeight.Black),
            modifier = Modifier.background(labelBg).padding(horizontal = hPad, vertical = vPad),
        )
        Text(
            value, color = valueFg, style = pillTextStyle(fontSize, FontWeight.SemiBold),
            modifier = Modifier.background(CardElevated).padding(horizontal = hPad, vertical = vPad),
        )
    }
}

/** Solid pill: a single colour-coded value on the dark surface (Metacritic). */
@Composable
private fun SinglePill(
    text: String, fg: Color,
    fontSize: TextUnit, hPad: Dp, vPad: Dp, corner: Dp,
    modifier: Modifier = Modifier,
) {
    Text(
        text, color = fg, style = pillTextStyle(fontSize, FontWeight.SemiBold),
        modifier = modifier
            .clip(RoundedCornerShape(corner))
            .background(CardElevated)
            .padding(horizontal = hPad, vertical = vPad),
    )
}

private fun metaColor(score: Int): Color = when {
    score >= 61 -> MetaGood
    score >= 40 -> MetaMid
    else -> MetaBad
}

/** One-decimal IMDb score, dot separator regardless of locale ("7" → "7.0"). */
private fun oneDecimal(value: Double): String = String.format(java.util.Locale.US, "%.1f", value)

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
