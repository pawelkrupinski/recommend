package pl.filmowo

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import pl.filmowo.ui.theme.Background
import pl.filmowo.ui.theme.FilmowoTheme

// Placeholder composition root — the full app (OkHttp client + cookie jar + api +
// auth + view model + navigation) is wired in here in the next stage.
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            FilmowoTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = Background) {
                    Text("Filmowo")
                }
            }
        }
    }
}
