package pl.filmowo

import androidx.compose.foundation.layout.Column
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.height
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import pl.filmowo.model.Pick
import pl.filmowo.ui.common.RatingBadges

/**
 * The badge strip reserves a constant height so a card still awaiting its
 * IMDb/Metacritic badges is exactly as tall as one showing them — that keeps
 * side-by-side cards in a grid row the same height (their stars/buttons align).
 * Rendered off-device via Robolectric.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RatingBadgesTest {
    @get:Rule val rule = createComposeRule()

    @Test
    fun `badges reserve the same height with and without ratings`() {
        rule.setContent {
            Column {
                RatingBadges(Pick(tmdbId = 1, imdbRating = 8.1, metascore = 73), Modifier.testTag("with"))
                RatingBadges(Pick(tmdbId = 2), Modifier.testTag("without"))
            }
        }
        val withBadges = rule.onNodeWithTag("with").getUnclippedBoundsInRoot().height
        val without = rule.onNodeWithTag("without").getUnclippedBoundsInRoot().height
        assertEquals(withBadges.value.toDouble(), without.value.toDouble(), 0.5)
    }

    @Test
    fun `imdb is a two-part label+value pill and metacritic a bare score`() {
        // Matching the movies app: IMDb splits into an "IMDb" label tab and a
        // one-decimal value tab (never a whole number), Metacritic is just the
        // colour-coded number — not the old single "IMDb 7" / "MC 83" pills.
        rule.setContent { RatingBadges(Pick(tmdbId = 1, imdbRating = 7.0, metascore = 83)) }
        rule.onNodeWithText("IMDb").assertExists()
        rule.onNodeWithText("7.0").assertExists()
        rule.onNodeWithText("83").assertExists()
        rule.onNodeWithText("MC 83").assertDoesNotExist()
        rule.onNodeWithText("IMDb 7.0").assertDoesNotExist()
    }
}
