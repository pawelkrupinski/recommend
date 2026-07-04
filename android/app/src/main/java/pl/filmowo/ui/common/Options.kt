package pl.filmowo.ui.common

import androidx.compose.foundation.layout.Box
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics

// Shared option lists for the Settings + first-run Onboarding choosers. Country
// set mirrors the web app's COUNTRIES; languages mirror i18n.js LANGUAGES.
val COUNTRIES = listOf(
    "PL" to "Poland", "US" to "United States", "GB" to "United Kingdom", "DE" to "Germany",
    "FR" to "France", "ES" to "Spain", "IT" to "Italy", "NL" to "Netherlands",
    "SE" to "Sweden", "CA" to "Canada", "AU" to "Australia",
)
val LANGUAGES = listOf("en" to "English", "pl" to "Polski")

/** A dropdown row that marks the currently-selected option with the accent
 *  colour and a trailing check, so a reopened menu shows what's active. Shared
 *  by every dropdown in the app. */
@Composable
fun SelectableMenuItem(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val accent = MaterialTheme.colorScheme.primary
    DropdownMenuItem(
        text = { Text(label, color = if (selected) accent else Color.Unspecified) },
        trailingIcon = if (selected) {
            { Icon(Icons.Filled.Check, contentDescription = null, tint = accent) }
        } else null,
        onClick = onClick,
        modifier = Modifier.semantics { this.selected = selected },
    )
}

/** A labelled dropdown chooser: `current` shown on the button, `options` are
 *  (value, label) pairs, `onSelect` gets the chosen value. The option matching
 *  `current` is highlighted in the open menu. */
@Composable
fun Chooser(current: String, options: List<Pair<String, String>>, onSelect: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { open = true }) { Text(current) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (value, label) ->
                SelectableMenuItem(label, selected = label == current, onClick = { open = false; onSelect(value) })
            }
        }
    }
}
