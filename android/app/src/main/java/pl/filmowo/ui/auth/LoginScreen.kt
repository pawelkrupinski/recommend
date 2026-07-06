package pl.filmowo.ui.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pl.filmowo.i18n.t
import pl.filmowo.model.Me
import pl.filmowo.ui.theme.TextMuted

/**
 * The sign-in screen reached from the first-run start screen: the Google/Facebook
 * links plus a way back to onboarding. After a successful sign-in the deep-link
 * exchange refreshes `me`, and [pl.filmowo.ui.FilmowoApp] routes to Discover (an
 * already-onboarded account) or back to the streaming setup (a new one).
 */
@Composable
fun LoginScreen(
    me: Me?,
    onSignIn: (String) -> Unit,
    onBack: () -> Unit,
) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        TextButton(onClick = onBack) { Text("← " + t("common.back")) }
        Text(t("login.title"), fontWeight = FontWeight.Bold, fontSize = 24.sp)
        Text(t("login.intro"), color = TextMuted)
        SignInButtons(me = me, onSignIn = onSignIn)
    }
}
