package pl.filmowo

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertTopPositionInRootIsEqualTo
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onChildren
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import pl.filmowo.i18n.LocalLanguage
import pl.filmowo.model.Genre
import pl.filmowo.ui.DiscoverMode
import pl.filmowo.ui.DiscoverState
import pl.filmowo.ui.discover.DiscoverScreen
import pl.filmowo.ui.theme.FilmowoTheme

/**
 * The Discover selector bar has minimal vertical padding — the first selector sits
 * ~2dp below the bar's top edge (0.25x the former 8dp), so the navbar hugs the top.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class FilterBarPaddingTest {
    @get:Rule val rule = createComposeRule()

    @Test
    fun `the selector bar has tight vertical padding`() {
        rule.setContent {
            FilmowoTheme {
                CompositionLocalProvider(LocalLanguage provides "en") {
                    DiscoverScreen(
                        state = DiscoverState(mode = DiscoverMode.PICKS), // picks empty → bar + empty text, no Coil
                        genres = listOf(Genre(28, "Action")),
                        tones = emptyList(),
                        onType = {}, onGenre = {}, onTone = {}, onRefresh = {},
                        onOpen = {}, onRatePick = { _, _ -> }, onSave = {}, onDismiss = {},
                        onRateQueue = { _, _ -> }, onSkipQueue = {},
                    )
                }
            }
        }
        // The bar is at the top of the screen, so its first selector's top offset is
        // exactly the bar's top padding — 2dp (was 8dp before the change).
        rule.onNodeWithTag("filterBar", useUnmergedTree = true)
            .onChildren().onFirst()
            .assertTopPositionInRootIsEqualTo(2.dp)
    }
}
