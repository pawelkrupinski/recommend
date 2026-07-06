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
import pl.filmowo.model.Me
import pl.filmowo.ui.auth.LoginScreen
import pl.filmowo.ui.theme.FilmowoTheme

/**
 * The first-run login screen surfaces exactly the OAuth providers the server
 * advertises in me.providers, and a note when none are enabled. Rendered off-device.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class LoginScreenTest {
    @get:Rule val rule = createComposeRule()

    private fun setLogin(providers: List<String>) {
        rule.setContent {
            FilmowoTheme {
                CompositionLocalProvider(LocalLanguage provides "en") {
                    LoginScreen(me = Me(providers = providers), onSignIn = {}, onBack = {})
                }
            }
        }
    }

    @Test fun `shows Google and Facebook when both providers are enabled`() {
        setLogin(listOf("google", "facebook"))
        rule.onNodeWithText("Sign in with Google").assertIsDisplayed()
        rule.onNodeWithText("Sign in with Facebook").assertIsDisplayed()
    }

    @Test fun `shows the no-providers note when none are enabled`() {
        setLogin(emptyList())
        rule.onNodeWithText("No sign-in providers are available right now.").assertIsDisplayed()
    }
}
