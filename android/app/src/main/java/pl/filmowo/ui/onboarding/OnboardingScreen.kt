package pl.filmowo.ui.onboarding

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Text
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
import pl.filmowo.ui.theme.TextMuted

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun OnboardingScreen(
    me: Me?,
    settings: SettingsData,
    onLoadServices: () -> Unit,
    onCountry: (String) -> Unit,
    onLanguage: (String) -> Unit,
    onToggleService: (Int) -> Unit,
    onComplete: () -> Unit,
) {
    LaunchedEffect(me?.country) { onLoadServices() }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Text(t("onboarding.welcome"), fontWeight = FontWeight.Bold, fontSize = 24.sp)
        Text(t("onboarding.intro"), color = TextMuted)

        Text(t("settings.language"), fontWeight = FontWeight.SemiBold)
        Chooser(LANGUAGES.firstOrNull { it.first == me?.language }?.second ?: "English", LANGUAGES, onLanguage)

        Text(t("settings.country"), fontWeight = FontWeight.SemiBold)
        Chooser(COUNTRIES.firstOrNull { it.first == me?.country }?.second ?: (me?.country ?: ""), COUNTRIES, onCountry)

        Text(t("settings.services"), fontWeight = FontWeight.SemiBold)
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

        Button(onClick = onComplete, modifier = Modifier.fillMaxWidth()) { Text(t("onboarding.start")) }
    }
}
