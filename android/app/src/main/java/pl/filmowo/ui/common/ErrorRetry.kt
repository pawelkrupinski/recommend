package pl.filmowo.ui.common

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import pl.filmowo.i18n.t
import pl.filmowo.ui.theme.TextMuted

/** A centered "couldn't load" message with a Retry button — the resilience
 *  fallback for the boot probe and the Discover load when the server is
 *  unreachable, so the app never hangs on a perpetual spinner. */
@Composable
fun ErrorRetry(message: String, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
    ) {
        Text(message, color = TextMuted, textAlign = TextAlign.Center)
        Button(onClick = onRetry) { Text(t("common.retry")) }
    }
}
