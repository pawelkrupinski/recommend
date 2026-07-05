package pl.filmowo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import pl.filmowo.ui.common.lazyScrollbarThumb
import pl.filmowo.ui.common.scrollbarThumb

/** The scrollbar thumb geometry — pure math, so it's tested without a UI. */
class ScrollbarTest {

    @Test
    fun `no thumb when it all fits`() {
        assertNull("nothing to scroll", scrollbarThumb(scrollValue = 0f, maxScroll = 0f, viewportPx = 800f))
        // 3 items @100px + no spacing = 300px content in an 800px viewport → fits.
        assertNull(lazyScrollbarThumb(0, 0, columns = 1, totalItems = 3, avgItemSizePx = 100f, spacingPx = 0f, viewportPx = 800f))
    }

    @Test
    fun `pixel thumb is the viewport's share of the content, offset by scroll`() {
        val top = scrollbarThumb(scrollValue = 0f, maxScroll = 300f, viewportPx = 100f)!!
        assertEquals(100f / 400f, top.heightFraction, 1e-4f) // viewport / (viewport + max)
        assertEquals(0f, top.offsetFraction, 1e-4f)

        val bottom = scrollbarThumb(scrollValue = 300f, maxScroll = 300f, viewportPx = 100f)!!
        assertEquals(1f, bottom.offsetFraction, 1e-4f)
    }

    @Test
    fun `lazy thumb advances smoothly within a row, not in whole-item jumps`() {
        // 20 rows @100px, 1 column, 500px viewport → content 2000, maxScroll 1500.
        fun at(index: Int, offset: Int) =
            lazyScrollbarThumb(index, offset, columns = 1, totalItems = 20, avgItemSizePx = 100f, spacingPx = 0f, viewportPx = 500f)!!

        val rowStart = at(5, 0)      // scrolled 500 → 500/1500
        val midRow = at(5, 50)       // scrolled 550 → a HALF-item nudge, not zero movement
        val nextRow = at(6, 0)       // scrolled 600 → 600/1500

        assertTrue("half-scrolling a row must move the thumb", midRow.offsetFraction > rowStart.offsetFraction)
        assertTrue(midRow.offsetFraction < nextRow.offsetFraction)
        // Exactly halfway between the two row boundaries — i.e. continuous, no jump.
        assertEquals((rowStart.offsetFraction + nextRow.offsetFraction) / 2f, midRow.offsetFraction, 1e-4f)
    }

    @Test
    fun `lazy grid maps the item index to its row via the column count`() {
        // 2 columns, 10 items → 5 rows @100px, 250px viewport (content 500, max 250).
        // firstIndex 4 = row 2 → scrolled 200 → 200/250 = 0.8.
        val t = lazyScrollbarThumb(firstIndex = 4, firstOffsetPx = 0, columns = 2, totalItems = 10, avgItemSizePx = 100f, spacingPx = 0f, viewportPx = 250f)!!
        assertEquals(0.8f, t.offsetFraction, 1e-4f)
        assertEquals(250f / 500f, t.heightFraction, 1e-4f)
    }

    @Test
    fun `row spacing is counted in the content height`() {
        // 10 rows @100px with 20px gaps → pitch 120, content 1200 (not 1000).
        val t = lazyScrollbarThumb(firstIndex = 0, firstOffsetPx = 0, columns = 1, totalItems = 10, avgItemSizePx = 100f, spacingPx = 20f, viewportPx = 300f)!!
        assertEquals(300f / 1200f, t.heightFraction, 1e-4f)
    }
}
