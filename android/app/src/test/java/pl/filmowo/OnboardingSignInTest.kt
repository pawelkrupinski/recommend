package pl.filmowo

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import pl.filmowo.i18n.LocalLanguage
import pl.filmowo.model.Me
import pl.filmowo.ui.SettingsData
import pl.filmowo.ui.onboarding.OnboardingScreen
import pl.filmowo.ui.theme.FilmowoTheme

/**
 * The start screen offers a sign-in entry that leads to the login screen — the
 * "already have an account?" path onto Discover (onboarded) or streaming setup.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class OnboardingSignInTest {
    @get:Rule val rule = createComposeRule()

    @Test fun `the start screen offers a sign-in entry that fires the callback`() {
        var tapped = false
        rule.setContent {
            FilmowoTheme {
                CompositionLocalProvider(LocalLanguage provides "en") {
                    OnboardingScreen(
                        me = Me(country = "PL"),
                        settings = SettingsData(),
                        onLoadServices = {}, onCountry = {}, onLanguage = {},
                        onToggleService = {}, onComplete = {}, onSignIn = { tapped = true },
                    )
                }
            }
        }
        rule.onNodeWithText("Already have an account? Sign in").assertIsDisplayed().performClick()
        assertTrue("tapping the sign-in entry fires onSignIn", tapped)
    }
}
