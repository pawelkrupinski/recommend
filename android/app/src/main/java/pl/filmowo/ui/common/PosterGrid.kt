package pl.filmowo.ui.common

import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** The minimum poster width the grid aims for; wider screens fit more columns. */
private val POSTER_MIN_WIDTH = 170.dp

/** Every movie grid shows at least this many columns, even on narrow phones. */
private const val MIN_COLUMNS = 2

/**
 * A [GridCells] that lays posters out like [GridCells.Adaptive] — as many
 * columns as fit at [POSTER_MIN_WIDTH] — but never fewer than [MIN_COLUMNS].
 * On a narrow phone (~360dp) two 170dp posters don't fit side by side, so plain
 * Adaptive collapses to a single column; this keeps at least two, letting the
 * posters shrink below the target width rather than stack one per row.
 */
val PosterGridCells: GridCells = AdaptiveMinColumns(POSTER_MIN_WIDTH, MIN_COLUMNS)

private class AdaptiveMinColumns(
    private val minSize: Dp,
    private val minColumns: Int,
) : GridCells {
    override fun Density.calculateCrossAxisCellSizes(availableSize: Int, spacing: Int): List<Int> =
        adaptiveMinCellSizes(availableSize, minSize.roundToPx(), spacing, minColumns)

    override fun hashCode(): Int = minSize.hashCode() * 31 + minColumns

    override fun equals(other: Any?): Boolean =
        other is AdaptiveMinColumns && other.minSize == minSize && other.minColumns == minColumns
}

/**
 * Column widths (in px) for a grid that fits as many [minSizePx]-wide cells as
 * it can into [availableSize], but never fewer than [minColumns]. The rounding
 * remainder goes to the leftmost cells — matching Compose's own Adaptive/Fixed
 * cell sizing so posters tile evenly with no leftover gap. Pure math, so it's
 * covered by PosterGridTest without a UI.
 */
internal fun adaptiveMinCellSizes(
    availableSize: Int,
    minSizePx: Int,
    spacing: Int,
    minColumns: Int,
): List<Int> {
    val fit = (availableSize + spacing) / (minSizePx + spacing)
    val count = maxOf(fit, minColumns)
    val gridSize = availableSize - spacing * (count - 1)
    val cellSize = gridSize / count
    val remainder = gridSize % count
    return List(count) { cellSize + if (it < remainder) 1 else 0 }
}
