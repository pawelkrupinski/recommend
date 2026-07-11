import SwiftUI
import FilmowoCore

/// The floating search screen, presented as a sheet from the main tabs: a search
/// field plus the same poster grid as Discover. Results are titles matching the
/// query by name, server-sorted on-service-first — you can rate them, add them to
/// your watchlist, tap a service logo to watch, or open the detail sheet, exactly
/// as on Discover (it reuses ``CardView``, ``openService`` and ``DetailSheet``).
struct SearchView: View {
    @ObservedObject var store: SearchStore
    @Environment(\.language) private var language
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Card?

    // Same adaptive columns as DiscoverView so cards line up identically.
    private let columns = [GridItem(.adaptive(minimum: 155, maximum: 240), spacing: 12)]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                searchField
                content
            }
            .navigationTitle(I18n.t(language, "nav.search"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(I18n.t(language, "common.close")) { dismiss() }
                        .accessibilityIdentifier(AXID.searchClose)
                }
            }
            .task { await store.loadMembership() }
            .sheet(item: $selected) { card in
                DetailSheet(
                    card: card,
                    enrichment: store.enrichment(for: card),
                    isSaved: store.watchlistKeys.contains(card.key),
                    load: { await store.whereToWatch(card) },
                    onRate: { v in Task { await store.rate(card, value: v); selected = nil } },
                    onToggleSave: { Task { await store.toggleWatchlist(card) } }
                )
                .language(language)
            }
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField(I18n.t(language, "search.placeholder"), text: $store.query)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .onChange(of: store.query) { _ in store.search() }
                .onSubmit { store.search() }
                .accessibilityIdentifier(AXID.searchField)
            if !store.query.isEmpty {
                Button { store.query = ""; store.search() } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(.quaternary, in: Capsule())
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    @ViewBuilder
    private var content: some View {
        switch store.phase {
        case .idle:
            Text(I18n.t(language, "search.prompt"))
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .error:
            RetryView(message: I18n.t(language, "error.offline")) { store.search() }
        case .empty:
            Text(I18n.t(language, "search.empty"))
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .results:
            resultsGrid
        }
    }

    private var resultsGrid: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 16) {
                ForEach(store.results) { card in
                    CardView(
                        card: card,
                        enrichment: store.enrichment(for: card),
                        ratedValue: nil,
                        isSaved: store.watchlistKeys.contains(card.key),
                        onTap: { selected = card },
                        onRate: { v in Task { await store.rate(card, value: v) } },
                        onToggleSave: { Task { await store.toggleWatchlist(card) } },
                        onDismiss: { Task { await store.dismiss(card) } },
                        onTapService: { svc in
                            openService(svc, where: { await store.whereToWatch(card) }) { openURL($0) }
                        }
                    )
                }
            }
            .padding()
        }
        .accessibilityIdentifier(AXID.searchGrid)
    }
}
