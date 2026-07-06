package pl.filmowo

import org.junit.Assert.assertEquals
import org.junit.Test
import pl.filmowo.ui.common.starAt

/** The star-hit math behind the rating widget — pure, so tested without a UI.
 *  A single row maps left-to-right 1..10; two rows split it 1..5 over 6..10. */
class RateStarsGeometryTest {

    @Test
    fun `one row maps horizontally across all ten stars`() {
        val slop = 24f * 3f
        // 0..10% → star 1, 70..80% → star 8, the far right → star 10.
        assertEquals(1, starAt(x = 5f, y = 12f, width = 258, height = 24, rows = 1, vSlop = slop))
        assertEquals(8, starAt(x = 258 * 0.75f, y = 12f, width = 258, height = 24, rows = 1, vSlop = slop))
        assertEquals(10, starAt(x = 257f, y = 12f, width = 258, height = 24, rows = 1, vSlop = slop))
    }

    @Test
    fun `two rows put the top row at 1 to 5 and the bottom row at 6 to 10`() {
        val slop = 24f * 3f
        // height 50 = two 24px rows + a gap; y<25 is the top row, y>25 the bottom.
        // Same 45%-across column, different row → star 3 up top, 8 down below.
        assertEquals(3, starAt(x = 128 * 0.45f, y = 10f, width = 128, height = 50, rows = 2, vSlop = slop))
        assertEquals(8, starAt(x = 128 * 0.45f, y = 40f, width = 128, height = 50, rows = 2, vSlop = slop))
        // First and last cells of each row.
        assertEquals(1, starAt(x = 2f, y = 5f, width = 128, height = 50, rows = 2, vSlop = slop))
        assertEquals(10, starAt(x = 127f, y = 45f, width = 128, height = 50, rows = 2, vSlop = slop))
    }

    @Test
    fun `outside the stars horizontally or past the vertical slop is nothing`() {
        val slop = 24f * 3f // 72px past the top/bottom edge
        assertEquals(0, starAt(x = -1f, y = 10f, width = 128, height = 50, rows = 2, vSlop = slop))
        assertEquals(0, starAt(x = 200f, y = 10f, width = 128, height = 50, rows = 2, vSlop = slop))
        assertEquals(0, starAt(x = 40f, y = 50 + slop + 1f, width = 128, height = 50, rows = 2, vSlop = slop))
        assertEquals(0, starAt(x = 40f, y = -slop - 1f, width = 128, height = 50, rows = 2, vSlop = slop))
    }

    @Test
    fun `drifting just past the bottom edge stays on the last row`() {
        val slop = 24f * 3f
        // y a touch below the block but within slop → clamps to the bottom row.
        assertEquals(8, starAt(x = 128 * 0.45f, y = 55f, width = 128, height = 50, rows = 2, vSlop = slop))
    }
}
