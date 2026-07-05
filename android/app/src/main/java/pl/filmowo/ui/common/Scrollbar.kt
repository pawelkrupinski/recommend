package pl.filmowo.ui.common

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.ContentDrawScope
import androidx.compose.ui.unit.dp
import kotlin.math.ceil
import pl.filmowo.ui.theme.TextMuted

/**
 * A lightweight scroll indicator. Compose ships no scrollbar for Android lazy
 * lists, so this draws a thin thumb on the right edge that fades in while the
 * content is scrolling and out shortly after. Overloads cover the three scrollers
 * the app uses: [LazyGridState] (the picks / watchlist grids), [LazyListState]
 * (the ratings list) and [ScrollState] (the settings column).
 *
 * The thumb geometry is factored into pure functions so it can be unit-tested; the
 * drawing here is thin glue. For lazy scrollers the position is estimated in
 * PIXELS (average item size × row + the sub-item scroll offset), not in whole
 * item indexes — otherwise the thumb only moves once a whole item scrolls off and
 * reads as jumpy.
 */

/** Where the thumb sits, as fractions of the track (both 0..1). */
data class ScrollbarThumb(val offsetFraction: Float, val heightFraction: Float)

/** Thumb geometry for a pixel-based scroller: the thumb is the viewport's share of
 *  the whole content, positioned by how far it's scrolled. Null when it all fits. */
internal fun scrollbarThumb(scrollValue: Float, maxScroll: Float, viewportPx: Float): ScrollbarThumb? {
    if (maxScroll <= 0f || viewportPx <= 0f) return null
    val height = viewportPx / (viewportPx + maxScroll)
    val offset = scrollValue / maxScroll
    return ScrollbarThumb(offset.coerceIn(0f, 1f), height.coerceIn(0f, 1f))
}

/**
 * Thumb geometry for a lazy list/grid, estimated in pixels so it moves smoothly
 * *within* an item rather than jumping per item. Rows come from the item count and
 * column span; the current position is the first visible row's pixel top plus the
 * continuous [firstOffsetPx] the row is scrolled by. [avgItemSizePx] is the mean
 * main-axis size of the visible items (stable, so the thumb height doesn't jitter).
 */
internal fun lazyScrollbarThumb(
    firstIndex: Int, firstOffsetPx: Int, columns: Int,
    totalItems: Int, avgItemSizePx: Float, spacingPx: Float, viewportPx: Float,
): ScrollbarThumb? {
    if (avgItemSizePx <= 0f || viewportPx <= 0f) return null
    val cols = columns.coerceAtLeast(1)
    val rows = ceil(totalItems / cols.toFloat())
    val pitch = avgItemSizePx + spacingPx // one row's top-to-next-row distance
    val contentPx = pitch * rows
    if (contentPx <= viewportPx) return null
    val scrolled = (firstIndex / cols) * pitch + firstOffsetPx
    return scrollbarThumb(scrolled, contentPx - viewportPx, viewportPx)
}

private val THUMB_WIDTH = 4.dp
private val MIN_THUMB_HEIGHT = 24.dp // stays grabbable/visible on very long lists
private const val FADE_IN_MS = 150
private const val FADE_OUT_MS = 450
private const val FADE_OUT_DELAY_MS = 700

@Composable
private fun scrollAlpha(active: Boolean): Float {
    val alpha by animateFloatAsState(
        targetValue = if (active) 1f else 0f,
        animationSpec = tween(
            durationMillis = if (active) FADE_IN_MS else FADE_OUT_MS,
            delayMillis = if (active) 0 else FADE_OUT_DELAY_MS,
        ),
        label = "scrollbarAlpha",
    )
    return alpha
}

private fun ContentDrawScope.drawThumb(thumb: ScrollbarThumb?, alpha: Float, color: Color) {
    drawContent()
    if (thumb == null || alpha <= 0f) return
    val trackHeight = size.height
    val thumbHeight = (trackHeight * thumb.heightFraction)
        .coerceIn(MIN_THUMB_HEIGHT.toPx(), trackHeight)
    val y = (trackHeight - thumbHeight) * thumb.offsetFraction
    val widthPx = THUMB_WIDTH.toPx()
    drawRoundRect(
        color = color.copy(alpha = color.alpha * alpha),
        topLeft = Offset(size.width - widthPx, y),
        size = Size(widthPx, thumbHeight),
        cornerRadius = CornerRadius(widthPx / 2, widthPx / 2),
    )
}

@Composable
fun Modifier.scrollbar(state: LazyGridState, color: Color = TextMuted): Modifier {
    val alpha = scrollAlpha(state.isScrollInProgress)
    return drawWithContent {
        val info = state.layoutInfo
        val visible = info.visibleItemsInfo
        val thumb = if (visible.isEmpty()) null else lazyScrollbarThumb(
            firstIndex = state.firstVisibleItemIndex,
            firstOffsetPx = state.firstVisibleItemScrollOffset,
            columns = visible.maxOf { it.column } + 1,
            totalItems = info.totalItemsCount,
            avgItemSizePx = visible.sumOf { it.size.height }.toFloat() / visible.size,
            spacingPx = info.mainAxisItemSpacing.toFloat(),
            viewportPx = size.height,
        )
        drawThumb(thumb, alpha, color)
    }
}

@Composable
fun Modifier.scrollbar(state: LazyListState, color: Color = TextMuted): Modifier {
    val alpha = scrollAlpha(state.isScrollInProgress)
    return drawWithContent {
        val info = state.layoutInfo
        val visible = info.visibleItemsInfo
        val thumb = if (visible.isEmpty()) null else lazyScrollbarThumb(
            firstIndex = state.firstVisibleItemIndex,
            firstOffsetPx = state.firstVisibleItemScrollOffset,
            columns = 1,
            totalItems = info.totalItemsCount,
            avgItemSizePx = visible.sumOf { it.size }.toFloat() / visible.size,
            spacingPx = info.mainAxisItemSpacing.toFloat(),
            viewportPx = size.height,
        )
        drawThumb(thumb, alpha, color)
    }
}

@Composable
fun Modifier.scrollbar(state: ScrollState, color: Color = TextMuted): Modifier {
    val alpha = scrollAlpha(state.isScrollInProgress)
    return drawWithContent {
        drawThumb(scrollbarThumb(state.value.toFloat(), state.maxValue.toFloat(), size.height), alpha, color)
    }
}
