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
    @StateObject private var search: SearchStore
    @State private var selection = 0
    @State private var showingSearch = false

    init(app: AppModel) {
        _discover = StateObject(wrappedValue: DiscoverStore(client: app.client))
        _watchlist = StateObject(wrappedValue: WatchlistStore(client: app.client,
            sort: WatchlistStore.Sort(rawValue: app.me?.watchlistSort ?? "added") ?? .added))
        _ratings = StateObject(wrappedValue: RatingsStore(client: app.client))
        _settings = StateObject(wrappedValue: SettingsStore(app: app))
        _search = StateObject(wrappedValue: SearchStore(client: app.client))
    }

    private var language: String { app.language }

    private static let tabCount = 4

    var body: some View {
        TabView(selection: $selection) {
            DiscoverView(store: discover)
                .tabItem { Label(I18n.t(language, "nav.discover"), systemImage: "sparkles") }
                .accessibilityIdentifier(AXID.tabDiscover)
                .tag(0)

            WatchlistView(store: watchlist)
                .tabItem { Label(I18n.t(language, "nav.watchlist"), systemImage: "bookmark") }
                .accessibilityIdentifier(AXID.tabWatchlist)
                .tag(1)

            RatingsView(store: ratings)
                .tabItem { Label(I18n.t(language, "nav.ratings"), systemImage: "star") }
                .accessibilityIdentifier(AXID.tabRatings)
                .tag(2)

            SettingsView(store: settings)
                .tabItem { Label(I18n.t(language, "nav.settings"), systemImage: "gearshape") }
                .accessibilityIdentifier(AXID.tabSettings)
                .tag(3)
        }
        // Swipe left/right anywhere on a screen to move to the next/previous tab.
        // A plain (low-priority) gesture so child scroll views and the star-rating
        // drag still win their touches; it only fires on a clearly-horizontal drag.
        .gesture(
            DragGesture(minimumDistance: 30, coordinateSpace: .local)
                .onEnded { value in
                    let dx = value.translation.width, dy = value.translation.height
                    guard abs(dx) > 60, abs(dx) > abs(dy) * 1.5 else { return }
                    let next = selection + (dx < 0 ? 1 : -1)
                    guard next >= 0, next < Self.tabCount else { return }
                    withAnimation { selection = next }
                }
        )
        // A floating search button hovering above every tab (bottom-trailing,
        // padded off the edge and clear of the tab bar): tap it to search titles
        // by name across the user's streaming services.
        .overlay(alignment: .bottomTrailing) { searchButton }
        .sheet(isPresented: $showingSearch) {
            SearchView(store: search).language(language)
        }
    }

    private var searchButton: some View {
        Button { showingSearch = true } label: {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 56, height: 56)
                .background(Color.accentColor, in: Circle())
                .shadow(radius: 4, y: 2)
        }
        .accessibilityIdentifier(AXID.searchButton)
        .accessibilityLabel(I18n.t(language, "nav.search"))
        .padding(.trailing, 20)
        .padding(.bottom, 60)
    }
}
