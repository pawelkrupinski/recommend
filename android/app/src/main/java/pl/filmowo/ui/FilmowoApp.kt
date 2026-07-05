package pl.filmowo.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Explore
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import pl.filmowo.i18n.LocalLanguage
import pl.filmowo.i18n.t
import pl.filmowo.ui.common.ErrorRetry
import pl.filmowo.ui.detail.DetailSheet
import pl.filmowo.ui.discover.DiscoverScreen
import pl.filmowo.ui.onboarding.OnboardingScreen
import pl.filmowo.ui.ratings.RatingsScreen
import pl.filmowo.ui.settings.SettingsScreen
import pl.filmowo.ui.watchlist.WatchlistScreen

private data class Tab(val route: String, val labelKey: String, val icon: ImageVector)

private val TABS = listOf(
    Tab("discover", "nav.discover", Icons.Filled.Explore),
    Tab("watchlist", "nav.watchlist", Icons.Filled.Bookmark),
    Tab("ratings", "nav.ratings", Icons.Filled.Star),
    Tab("settings", "nav.settings", Icons.Filled.Settings),
)

@Composable
fun FilmowoApp(vm: FilmowoViewModel) {
    val me by vm.me.collectAsStateWithLifecycle()
    val bootFailed by vm.bootFailed.collectAsStateWithLifecycle()
    val bootError by vm.bootError.collectAsStateWithLifecycle()

    CompositionLocalProvider(LocalLanguage provides (me?.language ?: "en")) {
        when {
            me?.onboarded == false -> FirstRunOnboarding(vm)
            me != null -> MainScaffold(vm)
            // No account yet AND the boot probe failed → error + Retry instead of
            // hanging on the spinner forever when the server is unreachable. The
            // exact failure reason rides under the message so a field report is
            // self-diagnosing.
            bootFailed -> ErrorRetry(
                listOfNotNull(t("error.offline"), bootError).joinToString("\n\n"),
                onRetry = vm::refreshAll,
            )
            else -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        }
    }
}

@Composable
private fun FirstRunOnboarding(vm: FilmowoViewModel) {
    val me by vm.me.collectAsStateWithLifecycle()
    val settings by vm.settings.collectAsStateWithLifecycle()
    OnboardingScreen(
        me = me,
        settings = settings,
        onLoadServices = vm::loadServices,
        onCountry = vm::setCountry,
        onLanguage = vm::setLanguage,
        onToggleService = vm::toggleService,
        onComplete = vm::completeOnboarding,
    )
}

@Composable
private fun MainScaffold(vm: FilmowoViewModel) {
    val nav = rememberNavController()
    val detail by vm.detail.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    // Hoisted here so re-tapping the active bottom-nav tab scrolls that tab's list
    // to the top (the Android analogue of iOS's tap-the-status-bar-to-scroll-top)
    // and so scroll position survives a tab switch.
    val discoverGrid = rememberLazyGridState()
    val watchlistGrid = rememberLazyGridState()
    val ratingsList = rememberLazyListState()

    Scaffold(
        bottomBar = {
            NavigationBar {
                val current by nav.currentBackStackEntryAsState()
                val route = current?.destination?.route
                TABS.forEach { tab ->
                    NavigationBarItem(
                        selected = route == tab.route,
                        onClick = {
                            if (route == tab.route) {
                                // Re-tap the already-active tab → scroll it to the top.
                                scope.launch {
                                    when (tab.route) {
                                        "discover" -> discoverGrid.animateScrollToItem(0)
                                        "watchlist" -> watchlistGrid.animateScrollToItem(0)
                                        "ratings" -> ratingsList.animateScrollToItem(0)
                                    }
                                }
                            } else {
                                nav.navigate(tab.route) {
                                    popUpTo(nav.graph.startDestinationId) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            }
                        },
                        icon = { Icon(tab.icon, contentDescription = null) },
                        label = { Text(t(tab.labelKey)) },
                    )
                }
            }
        },
    ) { padding ->
        NavHost(nav, startDestination = "discover", modifier = Modifier.padding(padding).fillMaxSize()) {
            composable("discover") { DiscoverTab(vm, discoverGrid) }
            composable("watchlist") { WatchlistTab(vm, watchlistGrid) }
            composable("ratings") { RatingsTab(vm, ratingsList) }
            composable("settings") { SettingsTab(vm) }
        }
    }

    detail?.let { DetailSheet(it, onClose = vm::closeDetail, onRate = vm::rateFromDetail) }
}

@Composable
private fun DiscoverTab(vm: FilmowoViewModel, gridState: LazyGridState) {
    val state by vm.discover.collectAsStateWithLifecycle()
    val genres by vm.genres.collectAsStateWithLifecycle()
    val tones by vm.tones.collectAsStateWithLifecycle()
    DiscoverScreen(
        state = state, genres = genres, tones = tones,
        onType = vm::setType, onGenre = vm::setGenre, onTone = vm::setTone,
        onRefresh = { vm.loadDiscover(refresh = true) },
        onOpen = { vm.openDetail(it) },
        onRatePick = vm::ratePick, onSave = vm::savePick, onDismiss = vm::dismissPick,
        onRateQueue = vm::rateQueueItem, onSkipQueue = vm::skipQueueItem,
        gridState = gridState,
    )
}

@Composable
private fun WatchlistTab(vm: FilmowoViewModel, gridState: LazyGridState) {
    val state by vm.watchlist.collectAsStateWithLifecycle()
    val me by vm.me.collectAsStateWithLifecycle()
    // Pull the watchlist from the server whenever the tab is opened and whenever
    // the account changes (e.g. right after signing in), so it stays in sync.
    LaunchedEffect(me?.user?.email, me?.anonymous) { vm.loadWatchlist() }
    WatchlistScreen(
        state = state,
        onOpen = { vm.openDetail(it, fromWatchlist = true) },
        onRemove = vm::removeFromWatchlist,
        onSort = vm::setWatchlistSort,
        gridState = gridState,
    )
}

@Composable
private fun RatingsTab(vm: FilmowoViewModel, listState: LazyListState) {
    val ratings by vm.ratings.collectAsStateWithLifecycle()
    RatingsScreen(ratings = ratings, onDelete = vm::deleteRating, listState = listState)
}

@Composable
private fun SettingsTab(vm: FilmowoViewModel) {
    val me by vm.me.collectAsStateWithLifecycle()
    val settings by vm.settings.collectAsStateWithLifecycle()
    val context = androidx.compose.ui.platform.LocalContext.current
    SettingsScreen(
        me = me, settings = settings,
        onLoadServices = vm::loadServices,
        onCountry = vm::setCountry, onLanguage = vm::setLanguage, onToggleService = vm::toggleService,
        onSignIn = { provider -> vm.signIn(context, provider) },
        onSignOut = vm::signOut, onDeleteAccount = vm::deleteAccount,
    )
}
