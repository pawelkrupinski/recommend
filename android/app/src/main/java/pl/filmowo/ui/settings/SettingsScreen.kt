package pl.filmowo.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pl.filmowo.i18n.t
import pl.filmowo.model.Me
import pl.filmowo.ui.SettingsData
import pl.filmowo.ui.common.COUNTRIES
import pl.filmowo.ui.common.Chooser
import pl.filmowo.ui.common.LANGUAGES
import pl.filmowo.ui.common.scrollbar
import pl.filmowo.ui.theme.TextMuted

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SettingsScreen(
    me: Me?,
    settings: SettingsData,
    onLoadServices: () -> Unit,
    onCountry: (String) -> Unit,
    onLanguage: (String) -> Unit,
    onToggleService: (Int) -> Unit,
    onSignIn: (String) -> Unit,
    onSignOut: () -> Unit,
    onDeleteAccount: () -> Unit,
) {
    LaunchedEffect(me?.country) { onLoadServices() }
    val scroll = rememberScrollState()
    Column(
        // scrollbar() before verticalScroll() so the thumb tracks the viewport
        // rather than scrolling away with the content.
        Modifier.fillMaxWidth().scrollbar(scroll).verticalScroll(scroll).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        // Account
        SectionTitle(t("settings.account"))
        if (me?.anonymous == false) {
            Text(me.user?.email ?: me.user?.name ?: "", fontWeight = FontWeight.SemiBold)
            OutlinedButton(onClick = onSignOut) { Text(t("settings.signOut")) }
        } else {
            Text(t("settings.anonymous"), color = TextMuted, fontSize = 13.sp)
            if (me?.providers?.contains("google") == true) {
                Button(onClick = { onSignIn("google") }, modifier = Modifier.fillMaxWidth()) { Text(t("settings.signInGoogle")) }
            }
            if (me?.providers?.contains("facebook") == true) {
                Button(onClick = { onSignIn("facebook") }, modifier = Modifier.fillMaxWidth()) { Text(t("settings.signInFacebook")) }
            }
        }

        // Language
        SectionTitle(t("settings.language"))
        Chooser(current = LANGUAGES.firstOrNull { it.first == me?.language }?.second ?: "English", options = LANGUAGES, onSelect = onLanguage)

        // Country
        SectionTitle(t("settings.country"))
        Chooser(current = COUNTRIES.firstOrNull { it.first == me?.country }?.second ?: (me?.country ?: ""), options = COUNTRIES, onSelect = onCountry)

        // Streaming services
        SectionTitle(t("settings.services"))
        val selected = me?.services ?: emptyList()
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            settings.services.forEach { svc ->
                FilterChip(
                    selected = svc.id in selected,
                    onClick = { onToggleService(svc.id) },
                    label = { Text(svc.name, fontSize = 12.sp) },
                )
            }
        }

        // Danger zone
        TextButton(onClick = onDeleteAccount) {
            Text(t("settings.deleteAccount"), color = pl.filmowo.ui.theme.MetaBad)
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, fontWeight = FontWeight.Bold, fontSize = 16.sp)
}
