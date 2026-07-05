package pl.filmowo

import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import pl.filmowo.i18n.LocalLanguage
import pl.filmowo.model.Pick
import pl.filmowo.ui.WatchlistState
import pl.filmowo.ui.theme.FilmowoTheme
import pl.filmowo.ui.watchlist.WatchlistScreen

/**
 * The scrollable tabs drive a hoisted scroll state, so re-tapping the active
 * bottom-nav tab can scroll the list to the top (FilmowoApp wires the re-tap to
 * `gridState.animateScrollToItem(0)`). This proves the screen actually uses the
 * injected state: a swipe moves it, and scrolling it to 0 returns to the top.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ScrollToTopTest {
    @get:Rule val rule = createComposeRule()

    @Test
    fun `the watchlist grid is driven by the hoisted state so it can scroll to top`() {
        val gridState = LazyGridState()
        val items = List(40) { Pick(tmdbId = it, title = "M$it") } // posterPath null → no Coil load

        rule.setContent {
            FilmowoTheme {
                CompositionLocalProvider(LocalLanguage provides "en") {
                    WatchlistScreen(
                        state = WatchlistState(items = items),
                        onOpen = {}, onRemove = {}, onSort = {}, gridState = gridState,
                    )
                }
            }
        }

        // Scroll the grid down with a gesture — the hoisted state must reflect it.
        rule.onRoot().performTouchInput { swipeUp() }
        rule.onRoot().performTouchInput { swipeUp() }
        rule.waitForIdle()
        assertTrue("the screen must drive the hoisted grid state", gridState.firstVisibleItemIndex > 0)

        // Scrolling that state to item 0 (what the nav re-tap does) returns to the top.
        rule.runOnIdle { runBlocking { gridState.scrollToItem(0) } }
        rule.waitForIdle()
        assertEquals(0, gridState.firstVisibleItemIndex)
    }
}
