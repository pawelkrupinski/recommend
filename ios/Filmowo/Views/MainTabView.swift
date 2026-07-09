import SwiftUI
import FilmowoCore

/// The four-screen main scaffold (Discover, Watchlist, Ratings, Settings),
/// matching Android's bottom navigation and the web app's tab routes. Each
/// screen owns its store, wired to the shared client.
///
/// Built as a sliding container + custom bottom bar rather than a `TabView` so a
/// swipe (or a bar tap) visibly *slides* between screens — a plain `TabView` only
/// cuts. Only the selected screen is mounted (matching how `TabView` keeps
/// off-screen tabs out of the accessibility tree); its store keeps the data, so
/// sliding back doesn't refetch or blank to a spinner.
struct MainTabView: View {
    @EnvironmentObject private var app: AppModel
    @StateObject private var discover: DiscoverStore
    @StateObject private var watchlist: WatchlistStore
    @StateObject private var ratings: RatingsStore
    @StateObject private var settings: SettingsStore
    @State private var selection = 0
    /// Direction of the last switch, so the incoming screen slides in from the
    /// correct edge.
    @State private var forward = true

    init(app: AppModel) {
        _discover = StateObject(wrappedValue: DiscoverStore(client: app.client))
        _watchlist = StateObject(wrappedValue: WatchlistStore(client: app.client,
            sort: WatchlistStore.Sort(rawValue: app.me?.watchlistSort ?? "added") ?? .added))
        _ratings = StateObject(wrappedValue: RatingsStore(client: app.client))
        _settings = StateObject(wrappedValue: SettingsStore(app: app))
    }

    private var language: String { app.language }

    private var tabs: [(label: String, icon: String, axid: String)] {
        [(I18n.t(language, "nav.discover"), "sparkles", AXID.tabDiscover),
         (I18n.t(language, "nav.watchlist"), "bookmark", AXID.tabWatchlist),
         (I18n.t(language, "nav.ratings"), "star", AXID.tabRatings),
         (I18n.t(language, "nav.settings"), "gearshape", AXID.tabSettings)]
    }

    var body: some View {
        GeometryReader { proxy in
            VStack(spacing: 0) {
                pager
                tabBar(bottomInset: proxy.safeAreaInsets.bottom)
            }
            .ignoresSafeArea(edges: .bottom)
        }
    }

    /// The selected screen, sliding in from the trailing edge when moving forward
    /// and the leading edge when moving back.
    private var pager: some View {
        ZStack {
            currentScreen
                .id(selection)
                .transition(.asymmetric(
                    insertion: .move(edge: forward ? .trailing : .leading),
                    removal: .move(edge: forward ? .leading : .trailing)))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
        .contentShape(Rectangle())
        // Swipe left/right to slide to the next/previous screen. A plain
        // (low-priority) gesture so child scroll views and the star-rating drag
        // still win their touches; it only fires on a clearly-horizontal drag.
        .gesture(
            DragGesture(minimumDistance: 30, coordinateSpace: .local)
                .onEnded { value in
                    let dx = value.translation.width, dy = value.translation.height
                    guard abs(dx) > 60, abs(dx) > abs(dy) * 1.5 else { return }
                    switchTo(selection + (dx < 0 ? 1 : -1))
                }
        )
    }

    @ViewBuilder
    private var currentScreen: some View {
        switch selection {
        case 0: DiscoverView(store: discover)
        case 1: WatchlistView(store: watchlist)
        case 2: RatingsView(store: ratings)
        default: SettingsView(store: settings)
        }
    }

    private func tabBar(bottomInset: CGFloat) -> some View {
        HStack(spacing: 0) {
            ForEach(Array(tabs.enumerated()), id: \.offset) { index, tab in
                Button {
                    switchTo(index)
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: tab.icon).font(.system(size: 20))
                        Text(tab.label).font(.caption2)
                    }
                    .frame(maxWidth: .infinity)
                    .foregroundStyle(index == selection ? Color.accentColor : Color.secondary)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier(tab.axid)
                .accessibilityLabel(tab.label)
                .accessibilityAddTraits(index == selection ? .isSelected : [])
            }
        }
        .padding(.top, 8)
        // Lift the icons above the home indicator while the `.bar` material fills
        // to the very bottom edge (the VStack ignores the bottom safe area).
        .padding(.bottom, max(bottomInset, 8))
        .frame(maxWidth: .infinity)
        .background(.bar)
    }

    private func switchTo(_ index: Int) {
        guard index >= 0, index < tabs.count, index != selection else { return }
        forward = index > selection
        withAnimation(.easeInOut(duration: 0.28)) { selection = index }
    }
}
