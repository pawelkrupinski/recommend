package pl.filmowo.ui.search

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import pl.filmowo.i18n.t
import pl.filmowo.model.Pick
import pl.filmowo.ui.SearchState
import pl.filmowo.ui.common.PosterGridCells
import pl.filmowo.ui.common.scrollbar
import pl.filmowo.ui.discover.PickCard
import pl.filmowo.ui.theme.TextMuted

/**
 * The floating title-search screen: a text field at the top drives a debounced
 * [SearchState] query; matches render as the same [PickCard] grid Discover uses,
 * so the user can rate, save, dismiss, or tap through to the where-to-watch sheet.
 * Results arrive server-sorted on-service-first.
 */
@Composable
fun SearchScreen(
    state: SearchState,
    onQuery: (String) -> Unit,
    onOpen: (Pick) -> Unit,
    onRatePick: (Pick, Int) -> Unit,
    onSave: (Pick) -> Unit,
    onDismiss: (Pick) -> Unit,
    onBack: () -> Unit,
    gridState: LazyGridState = rememberLazyGridState(),
) {
    Column(Modifier.fillMaxSize()) {
        SearchField(state.query, onQuery, onBack)
        when {
            state.loading && state.results.isEmpty() -> Centered { CircularProgressIndicator() }
            state.query.isBlank() -> Centered { Hint(t("search.prompt")) }
            state.results.isEmpty() -> Centered { Hint(t("search.empty")) }
            else -> ResultsGrid(state, onOpen, onRatePick, onSave, onDismiss, gridState)
        }
    }
}

@Composable
private fun SearchField(query: String, onQuery: (String) -> Unit, onBack: () -> Unit) {
    // Focus the field on entry so the keyboard is up immediately (search is a
    // deliberate, type-now action reached via the floating button).
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    OutlinedTextField(
        value = query,
        onValueChange = onQuery,
        singleLine = true,
        placeholder = { Text(t("search.hint"), fontSize = 14.sp) },
        leadingIcon = {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = t("common.back"))
            }
        },
        trailingIcon = {
            if (query.isNotEmpty()) {
                IconButton(onClick = { onQuery("") }) {
                    Icon(Icons.Filled.Close, contentDescription = t("common.close"))
                }
            } else {
                Icon(Icons.Filled.Search, contentDescription = null)
            }
        },
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = ImeAction.Search),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .focusRequester(focus)
            .testTag("searchField"),
    )
}

@Composable
private fun ResultsGrid(
    state: SearchState,
    onOpen: (Pick) -> Unit,
    onRatePick: (Pick, Int) -> Unit,
    onSave: (Pick) -> Unit,
    onDismiss: (Pick) -> Unit,
    gridState: LazyGridState,
) {
    LazyVerticalGrid(
        columns = PosterGridCells,
        state = gridState,
        contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxSize().scrollbar(gridState),
    ) {
        items(state.results, key = { it.key }) { pick ->
            PickCard(pick, onOpen, onRatePick, onSave, onDismiss)
        }
    }
}

@Composable
private fun Hint(text: String) {
    Text(text, color = TextMuted, fontSize = 14.sp, modifier = Modifier.padding(24.dp))
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { content() }
}
