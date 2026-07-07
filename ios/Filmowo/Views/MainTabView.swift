import SwiftUI
import FilmowoCore

/// The four-tab main scaffold (Discover, Watchlist, Ratings, Settings), matching
/// Android's bottom navigation and the web app's tab routes. Discover is wired
/// here; the other tabs' stores land alongside their screens in the next slice.
struct MainTabView: View {
    @EnvironmentObject private var app: AppModel
    @StateObject private var discover: DiscoverStore

    init(app: AppModel) {
        _discover = StateObject(wrappedValue: DiscoverStore(client: app.client))
    }

    private var language: String { app.language }

    var body: some View {
        TabView {
            DiscoverView(store: discover)
                .tabItem { Label(I18n.t(language, "nav.discover"), systemImage: "sparkles") }
                .accessibilityIdentifier(AXID.tabDiscover)

            WatchlistTabPlaceholder()
                .tabItem { Label(I18n.t(language, "nav.watchlist"), systemImage: "bookmark") }
                .accessibilityIdentifier(AXID.tabWatchlist)

            RatingsTabPlaceholder()
                .tabItem { Label(I18n.t(language, "nav.ratings"), systemImage: "star") }
                .accessibilityIdentifier(AXID.tabRatings)

            SettingsTabPlaceholder()
                .tabItem { Label(I18n.t(language, "nav.settings"), systemImage: "gearshape") }
                .accessibilityIdentifier(AXID.tabSettings)
        }
    }
}

// Placeholders replaced by full screens in the Watchlist/Ratings/Settings slice.
private struct WatchlistTabPlaceholder: View {
    @Environment(\.language) private var language
    var body: some View {
        NavigationStack { Text(I18n.t(language, "nav.watchlist")).navigationTitle(I18n.t(language, "nav.watchlist")) }
    }
}
private struct RatingsTabPlaceholder: View {
    @Environment(\.language) private var language
    var body: some View {
        NavigationStack { Text(I18n.t(language, "nav.ratings")).navigationTitle(I18n.t(language, "nav.ratings")) }
    }
}
private struct SettingsTabPlaceholder: View {
    @Environment(\.language) private var language
    var body: some View {
        NavigationStack { Text(I18n.t(language, "nav.settings")).navigationTitle(I18n.t(language, "nav.settings")) }
    }
}
