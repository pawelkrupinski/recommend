package pl.filmowo

import androidx.compose.foundation.layout.Column
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import pl.filmowo.ui.common.SelectableMenuItem

/**
 * The shared dropdown row must mark the active option as selected so a reopened
 * menu shows what's chosen. Robolectric renders Compose off-device.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34]) // Robolectric doesn't ship an SDK 37 sandbox yet; pin a supported one.
class SelectableMenuItemTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun highlightsOnlyTheSelectedOption() {
        compose.setContent {
            Column {
                SelectableMenuItem("Added", selected = false, onClick = {})
                SelectableMenuItem("Rating", selected = true, onClick = {})
            }
        }

        compose.onNodeWithText("Rating").assertIsSelected()
        compose.onNodeWithText("Added").assertIsNotSelected()
    }
}
