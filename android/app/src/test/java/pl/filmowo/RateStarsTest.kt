package pl.filmowo

import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.click
import androidx.compose.ui.test.down
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.moveTo
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.up
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import pl.filmowo.ui.common.RateStars

/**
 * The rating widget supports the web's drag-to-rate: a horizontal drag across the
 * row rates by finger position (lift commits), and a tap still rates the star
 * under it. Rendered off-device via Robolectric.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RateStarsTest {
    @get:Rule val rule = createComposeRule()

    @Test
    fun `dragging across the stars rates by finger position`() {
        var rated = -1
        rule.setContent {
            RateStars(onRate = { rated = it }, modifier = Modifier.testTag("stars").width(250.dp))
        }
        // Lift at 75% across → the 8th of 10 stars (cell 8 spans 70–80%).
        rule.onNodeWithTag("stars").performTouchInput {
            down(Offset(1f, centerY))
            moveTo(Offset(right * 0.75f, centerY))
            up()
        }
        rule.runOnIdle { assertEquals(8, rated) }
    }

    @Test
    fun `tapping a star still rates it`() {
        var rated = -1
        rule.setContent {
            RateStars(onRate = { rated = it }, modifier = Modifier.testTag("stars").width(250.dp))
        }
        // Tap at 45% across → the 5th star (cell 5 spans 40–50%).
        rule.onNodeWithTag("stars").performTouchInput { click(Offset(right * 0.45f, centerY)) }
        rule.runOnIdle { assertEquals(5, rated) }
    }

    @Test
    fun `the value floats above and to the right of the stars while dragging`() {
        rule.setContent {
            RateStars(onRate = {}, modifier = Modifier.testTag("stars").width(250.dp))
        }
        rule.onNodeWithTag("stars").performTouchInput {
            down(Offset(1f, centerY))
            moveTo(Offset(right * 0.75f, centerY)) // preview → 8; no up() so it stays visible
        }
        val stars = rule.onNodeWithTag("stars").getUnclippedBoundsInRoot()
        val number = rule.onNodeWithText("8/10").getUnclippedBoundsInRoot()
        assertTrue("the number sits above the stars", number.top < stars.top)
        assertTrue("the number sits on the right", number.left > (stars.left + stars.right) / 2f)
    }

    @Test
    fun `a small vertical drift within one star-height still rates`() {
        var rated = -1
        rule.setContent {
            RateStars(onRate = { rated = it }, modifier = Modifier.testTag("stars").width(250.dp))
        }
        rule.onNodeWithTag("stars").performTouchInput {
            down(Offset(1f, centerY))
            moveTo(Offset(right * 0.75f, centerY))               // drag → 8
            moveTo(Offset(right * 0.75f, height + height * 0.5f)) // drift below, but within the 1× tolerance
            up()
        }
        rule.runOnIdle { assertEquals(8, rated) }
    }

    @Test
    fun `sliding off the stars clears the selection and submits nothing on lift`() {
        var rated = -1
        rule.setContent {
            RateStars(onRate = { rated = it }, modifier = Modifier.testTag("stars").width(250.dp))
        }
        rule.onNodeWithTag("stars").performTouchInput {
            down(Offset(1f, centerY))
            moveTo(Offset(right * 0.75f, centerY))     // a real (horizontal) drag starts → preview 8
            moveTo(Offset(right * 0.75f, height * 6f)) // slide far below the row → preview 0
            up()                                        // lift off the stars → nothing submitted
        }
        rule.runOnIdle { assertEquals(-1, rated) }
    }
}
