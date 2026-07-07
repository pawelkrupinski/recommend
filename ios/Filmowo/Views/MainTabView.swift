import SwiftUI
import FilmowoCore

/// The four-tab main scaffold (Discover, Watchlist, Ratings, Settings), matching
/// Android's bottom navigation and the web app's tab routes. Each tab owns its
/// store, wired to the shared client.
struct MainTabView: View {
    @EnvironmentObject private var app: AppModel
    @StateObject private var discover: DiscoverStore
    @StateObject private var watchlist: WatchlistStore
    @StateObject private var ratings: RatingsStore
    @StateObject private var settings: SettingsStore

    init(app: AppModel) {
        _discover = StateObject(wrappedValue: DiscoverStore(client: app.client))
        _watchlist = StateObject(wrappedValue: WatchlistStore(client: app.client,
            sort: WatchlistStore.Sort(rawValue: app.me?.watchlistSort ?? "added") ?? .added))
        _ratings = StateObject(wrappedValue: RatingsStore(client: app.client))
        _settings = StateObject(wrappedValue: SettingsStore(app: app))
    }

    private var language: String { app.language }

    var body: some View {
        TabView {
            DiscoverView(store: discover)
                .tabItem { Label(I18n.t(language, "nav.discover"), systemImage: "sparkles") }
                .accessibilityIdentifier(AXID.tabDiscover)

            WatchlistView(store: watchlist)
                .tabItem { Label(I18n.t(language, "nav.watchlist"), systemImage: "bookmark") }
                .accessibilityIdentifier(AXID.tabWatchlist)

            RatingsView(store: ratings)
                .tabItem { Label(I18n.t(language, "nav.ratings"), systemImage: "star") }
                .accessibilityIdentifier(AXID.tabRatings)

            SettingsView(store: settings)
                .tabItem { Label(I18n.t(language, "nav.settings"), systemImage: "gearshape") }
                .accessibilityIdentifier(AXID.tabSettings)
        }
    }
}
