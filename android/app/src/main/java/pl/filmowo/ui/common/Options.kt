package pl.filmowo.ui.common

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue

// Shared option lists for the Settings + first-run Onboarding choosers. Country
// set mirrors the web app's COUNTRIES; languages mirror i18n.js LANGUAGES.
val COUNTRIES = listOf(
    "PL" to "Poland", "US" to "United States", "GB" to "United Kingdom", "DE" to "Germany",
    "FR" to "France", "ES" to "Spain", "IT" to "Italy", "NL" to "Netherlands",
    "SE" to "Sweden", "CA" to "Canada", "AU" to "Australia",
)
val LANGUAGES = listOf("en" to "English", "pl" to "Polski")

/** A labelled dropdown chooser: `current` shown on the button, `options` are
 *  (value, label) pairs, `onSelect` gets the chosen value. */
@Composable
fun Chooser(current: String, options: List<Pair<String, String>>, onSelect: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { open = true }) { Text(current) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (value, label) ->
                DropdownMenuItem(text = { Text(label) }, onClick = { open = false; onSelect(value) })
            }
        }
    }
}
