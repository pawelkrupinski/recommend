import SwiftUI
import FilmowoCore

/// The Watchlist tab: saved titles in an adaptive grid with a sort control and
/// type/genre filters; rating a title removes it. Mirrors the web watchlist.
struct WatchlistView: View {
    @ObservedObject var store: WatchlistStore
    @Environment(\.language) private var language
    @Environment(\.openURL) private var openURL
    @State private var selected: Card?

    private let columns = [GridItem(.adaptive(minimum: 155, maximum: 240), spacing: 12)]

    var body: some View {
        NavigationStack {
            Group {
                if store.loading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if store.all.isEmpty {
                    Text(I18n.t(language, "watchlist.empty"))
                        .multilineTextAlignment(.center).foregroundStyle(.secondary).padding()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .accessibilityIdentifier(AXID.watchlistEmpty)
                } else {
                    grid
                }
            }
            .navigationTitle(I18n.t(language, "nav.watchlist"))
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { sortMenu }
            }
            .task { await store.load() }
            .sheet(item: $selected) { card in detailSheet(card) }
        }
    }

    private var grid: some View {
        ScrollView {
            Text(I18n.t(language, "watchlist.count", ["n": String(store.all.count)]))
                .font(.caption).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal)
            LazyVGrid(columns: columns, spacing: 16) {
                ForEach(store.visible) { card in
                    CardView(
                        card: card,
                        ratedValue: nil,
                        isSaved: true,
                        onTap: { selected = card },
                        onRate: { v in Task { await store.rate(card, value: v) } },
                        onToggleSave: { Task { await store.remove(card) } },
                        onDismiss: { Task { await store.remove(card) } },
                        onTapService: { svc in
                            openService(svc, where: { await store.whereToWatch(card) }) { openURL($0) }
                        }
                    )
                }
            }
            .padding()
        }
        .accessibilityIdentifier(AXID.discoverGrid)
    }

    private var sortMenu: some View {
        Menu {
            Button(I18n.t(language, "watchlist.sortAdded")) { store.setSort(.added) }
            Button(I18n.t(language, "watchlist.sortRating")) { store.setSort(.rating) }
        } label: {
            Image(systemName: "arrow.up.arrow.down")
        }
        .accessibilityIdentifier(AXID.watchlistSort)
    }

    private func detailSheet(_ card: Card) -> some View {
        DetailSheet(
            card: card,
            enrichment: nil,
            isSaved: true,
            load: { await store.whereToWatch(card) },
            onRate: { v in Task { await store.rate(card, value: v); selected = nil } },
            onToggleSave: { Task { await store.remove(card); selected = nil } }
        )
        .language(language)
    }
}
