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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
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

    CompositionLocalProvider(LocalLanguage provides (me?.language ?: "en")) {
        when {
            me == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            me?.onboarded == false -> FirstRunOnboarding(vm)
            else -> MainScaffold(vm)
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

    Scaffold(
        bottomBar = {
            NavigationBar {
                val current by nav.currentBackStackEntryAsState()
                val route = current?.destination?.route
                TABS.forEach { tab ->
                    NavigationBarItem(
                        selected = route == tab.route,
                        onClick = {
                            nav.navigate(tab.route) {
                                popUpTo(nav.graph.startDestinationId) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
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
            composable("discover") { DiscoverTab(vm) }
            composable("watchlist") { WatchlistTab(vm) }
            composable("ratings") { RatingsTab(vm) }
            composable("settings") { SettingsTab(vm) }
        }
    }

    detail?.let { DetailSheet(it, onClose = vm::closeDetail, onRate = vm::rateFromDetail) }
}

@Composable
private fun DiscoverTab(vm: FilmowoViewModel) {
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
    )
}

@Composable
private fun WatchlistTab(vm: FilmowoViewModel) {
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
    )
}

@Composable
private fun RatingsTab(vm: FilmowoViewModel) {
    val ratings by vm.ratings.collectAsStateWithLifecycle()
    RatingsScreen(ratings = ratings, onDelete = vm::deleteRating)
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
