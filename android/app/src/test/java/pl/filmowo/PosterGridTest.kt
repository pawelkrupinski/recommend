package pl.filmowo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import pl.filmowo.ui.common.adaptiveMinCellSizes

/** The poster grid's column math — pure, so it's tested without a UI. The whole
 *  point is that every movie screen keeps ≥2 columns even on narrow phones. */
class PosterGridTest {

    // 170dp posters, 12dp gaps, at a common ~2.75× density (≈360dp phone).
    private val minPx = 468   // 170dp @ 2.75
    private val gapPx = 33    // 12dp  @ 2.75

    @Test
    fun `narrow phone still gets two columns instead of collapsing to one`() {
        // ~360dp minus 24dp content padding ≈ 336dp → ~924px available. Only one
        // 468px poster "fits", but we force two: plain Adaptive would give one.
        val cells = adaptiveMinCellSizes(availableSize = 924, minSizePx = minPx, spacing = gapPx, minColumns = 2)
        assertEquals(2, cells.size)
        // The two cells plus the gap exactly fill the width — no leftover.
        assertEquals(924, cells.sum() + gapPx)
        assertTrue("posters shrink below the target width to fit two up", cells.first() < minPx)
    }

    @Test
    fun `wide screen fits more than the minimum`() {
        // A 1600px-wide tablet fits three 468px posters (+ gaps).
        val cells = adaptiveMinCellSizes(availableSize = 1600, minSizePx = minPx, spacing = gapPx, minColumns = 2)
        assertEquals(3, cells.size)
        assertEquals(1600, cells.sum() + gapPx * (cells.size - 1))
    }

    @Test
    fun `rounding remainder is spread across the leftmost cells`() {
        // 100px across 3 columns, no gaps → 34,33,33 (sums back to 100, no gap).
        val cells = adaptiveMinCellSizes(availableSize = 100, minSizePx = 30, spacing = 0, minColumns = 2)
        assertEquals(listOf(34, 33, 33), cells)
        assertEquals(100, cells.sum())
    }
}
