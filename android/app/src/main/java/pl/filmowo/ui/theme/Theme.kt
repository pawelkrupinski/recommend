package pl.filmowo.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Palette mirrors the web app's dark theme: amber accent (--accent), blue links
// (--link), near-black background, slate panels.
val Accent = Color(0xFFE0A106)      // amber — ratings/CTA
val Link = Color(0xFF5AA2FF)        // blue — links, secondary
val Background = Color(0xFF0B0B12)
val Panel = Color(0xFF16161F)
val Panel2 = Color(0xFF1E1E2A)
val Line = Color(0xFF2E2E3E)
val TextPrimary = Color(0xFFF2F2F5)
val TextMuted = Color(0xFF9A9AA8)

// Rating-badge inks (mirror the web `.rb.imdb` / `.rb.mc`).
val ImdbYellow = Color(0xFFF5C518)
// The value half of a two-tone rating pill sits on this raised surface (matches
// the movies app's CardElevated so the pills render identically).
val CardElevated = Color(0xFF2A2A3E)
val MetaGood = Color(0xFF66CC66)
val MetaMid = Color(0xFFE0C040)
val MetaBad = Color(0xFFE05050)

private val FilmowoColors = darkColorScheme(
    primary = Accent,
    onPrimary = Color(0xFF1A1200),
    secondary = Link,
    onSecondary = Color(0xFF04121F),
    background = Background,
    onBackground = TextPrimary,
    surface = Panel,
    onSurface = TextPrimary,
    surfaceVariant = Panel2,
    onSurfaceVariant = TextMuted,
    outline = Line,
)

@Composable
fun FilmowoTheme(content: @Composable () -> Unit) {
    // Dark-only, matching the web app.
    MaterialTheme(
        colorScheme = FilmowoColors,
        typography = MaterialTheme.typography,
        content = content,
    )
}
