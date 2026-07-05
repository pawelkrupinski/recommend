package pl.filmowo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import pl.filmowo.ui.common.scrollbarThumb

/** The scrollbar thumb geometry — pure math, so it's tested without a UI. */
class ScrollbarTest {

    @Test
    fun `no thumb when it all fits`() {
        assertNull("equal counts fit", scrollbarThumb(totalItems = 5, visibleItems = 5, firstVisibleIndex = 0))
        assertNull("more visible than total", scrollbarThumb(totalItems = 3, visibleItems = 10, firstVisibleIndex = 0))
        assertNull("nothing to scroll", scrollbarThumb(scrollValue = 0, maxScroll = 0, viewportPx = 800f))
    }

    @Test
    fun `item thumb height is the visible fraction and offset tracks position`() {
        val top = scrollbarThumb(totalItems = 100, visibleItems = 10, firstVisibleIndex = 0)!!
        assertEquals(0.1f, top.heightFraction, 1e-4f)
        assertEquals(0f, top.offsetFraction, 1e-4f)

        // firstVisibleIndex == total - visible → scrolled to the very bottom.
        val bottom = scrollbarThumb(totalItems = 100, visibleItems = 10, firstVisibleIndex = 90)!!
        assertEquals(1f, bottom.offsetFraction, 1e-4f)

        val mid = scrollbarThumb(totalItems = 100, visibleItems = 10, firstVisibleIndex = 45)!!
        assertEquals(0.5f, mid.offsetFraction, 1e-4f)
    }

    @Test
    fun `scroll thumb is the viewport's share of the content, offset by scroll`() {
        val top = scrollbarThumb(scrollValue = 0, maxScroll = 300, viewportPx = 100f)!!
        assertEquals(100f / 400f, top.heightFraction, 1e-4f) // viewport / (viewport + max)
        assertEquals(0f, top.offsetFraction, 1e-4f)

        val bottom = scrollbarThumb(scrollValue = 300, maxScroll = 300, viewportPx = 100f)!!
        assertEquals(1f, bottom.offsetFraction, 1e-4f)
    }
}
