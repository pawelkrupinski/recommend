package pl.filmowo.ui.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pl.filmowo.i18n.t
import pl.filmowo.model.Me
import pl.filmowo.ui.theme.TextMuted

/**
 * The OAuth sign-in buttons, gated by the providers the server advertises in
 * `me.providers`. Shared by the Settings account section and the first-run login
 * screen so the two never drift; renders a muted note when no provider is enabled.
 */
@Composable
fun SignInButtons(
    me: Me?,
    onSignIn: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val providers = me?.providers ?: emptyList()
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if ("google" in providers) {
            Button(onClick = { onSignIn("google") }, modifier = Modifier.fillMaxWidth()) { Text(t("settings.signInGoogle")) }
        }
        if ("facebook" in providers) {
            Button(onClick = { onSignIn("facebook") }, modifier = Modifier.fillMaxWidth()) { Text(t("settings.signInFacebook")) }
        }
        if ("google" !in providers && "facebook" !in providers) {
            Text(t("login.noProviders"), color = TextMuted, fontSize = 13.sp)
        }
    }
}
