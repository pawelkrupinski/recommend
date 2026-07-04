package pl.filmowo

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
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
 * The Discover filter bar no longer carries a Refresh button — refreshing is done
 * by pulling down on the grid. Rendered off-device via Robolectric.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DiscoverScreenTest {
    @get:Rule val rule = createComposeRule()

    @Test
    fun `the picks filter bar has no Refresh button`() {
        rule.setContent {
            FilmowoTheme {
                CompositionLocalProvider(LocalLanguage provides "en") {
                    DiscoverScreen(
                        state = DiscoverState(mode = DiscoverMode.PICKS), // empty picks → no grid/Coil
                        genres = listOf(Genre(28, "Action")),
                        tones = emptyList(),
                        onType = {}, onGenre = {}, onTone = {}, onRefresh = {},
                        onOpen = {}, onRatePick = { _, _ -> }, onSave = {}, onDismiss = {},
                        onRateQueue = { _, _ -> }, onSkipQueue = {},
                    )
                }
            }
        }
        // The filter bar rendered…
        rule.onNodeWithText("All genres").assertIsDisplayed()
        // …but the Refresh button is gone.
        rule.onNodeWithText("Refresh picks").assertDoesNotExist()
    }
}
