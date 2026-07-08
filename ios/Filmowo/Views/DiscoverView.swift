import SwiftUI
import FilmowoCore

/// The Discover tab: an adaptive poster grid that onboards new accounts with a
/// rate-queue of acclaimed titles, then shows personalized picks. Mirrors the
/// web Discover screen and Android's adaptive grid.
struct DiscoverView: View {
    @ObservedObject var store: DiscoverStore
    @Environment(\.language) private var language
    @Environment(\.openURL) private var openURL
    @State private var selected: Card?

    // Adaptive columns with a small enough minimum that even the narrowest iPhone
    // gets ≥2 columns (the Android "always ≥2 columns" guarantee); iPads fill more.
    private let columns = [GridItem(.adaptive(minimum: 155, maximum: 240), spacing: 12)]

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(I18n.t(language, "nav.discover"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            Task { await store.loadFeed(refresh: true) }
                        } label: { Image(systemName: "arrow.clockwise") }
                        .accessibilityIdentifier(AXID.discoverRefresh)
                    }
                }
                .safeAreaInset(edge: .top) {
                    if store.phase == .picks { filterBar }
                }
                .task { await store.loadInitial() }
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

    @ViewBuilder
    private var content: some View {
        switch store.phase {
        case .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .error:
            RetryView(message: I18n.t(language, "error.offline")) { Task { await store.loadFeed() } }
        case .building:
            VStack(spacing: 12) {
                ProgressView()
                Text(I18n.t(language, "discover.building")).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityIdentifier(AXID.discoverBuilding)
        case .empty:
            Text(I18n.t(language, "discover.empty"))
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .onboarding:
            onboardingGrid
        case .picks:
            picksGrid
        }
    }

    private var onboardingGrid: some View {
        ScrollView {
            Text(I18n.t(language, "discover.rateMore", ["n": String(store.leftToRate)]))
                .font(.headline)
                .multilineTextAlignment(.center)
                .padding()
            LazyVGrid(columns: columns, spacing: 16) {
                ForEach(store.queue) { item in
                    QueueCard(item: item) { value in
                        Task { await store.rateQueueItem(item, value: value) }
                    }
                }
            }
            .padding(.horizontal)
        }
        .accessibilityIdentifier(AXID.discoverGrid)
    }

    private var picksGrid: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 16) {
                ForEach(store.picks) { card in
                    CardView(
                        card: card,
                        enrichment: store.enrichment(for: card),
                        ratedValue: nil,
                        isSaved: store.watchlistKeys.contains(card.key),
                        onTap: { selected = card },
                        onRate: { v in Task { await store.rate(card, value: v) } },
                        onToggleSave: { Task { await store.toggleWatchlist(card) } },
                        onDismiss: { Task { await store.dismiss(card) } },
                        onNotSeen: { Task { await store.notSeen(card) } },
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

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                FilterMenu(title: typeLabel, id: AXID.discoverFilterType) {
                    Button(I18n.t(language, "filter.allTypes")) { store.type = nil; reload() }
                    Button(I18n.t(language, "filter.movie")) { store.type = "movie"; reload() }
                    Button(I18n.t(language, "filter.tv")) { store.type = "tv"; reload() }
                }
                FilterMenu(title: genreLabel, id: AXID.discoverFilterGenre) {
                    Button(I18n.t(language, "filter.allGenres")) { store.genre = nil; reload() }
                    ForEach(store.genres) { g in
                        Button(g.name) { store.genre = g.name; reload() }
                    }
                }
                if !store.tones.isEmpty {
                    FilterMenu(title: toneLabel, id: "discover-filter-tone") {
                        Button(I18n.t(language, "filter.allTones")) { store.tone = nil; reload() }
                        ForEach(store.tones) { t in
                            Button(t.label) { store.tone = t.slug; reload() }
                        }
                    }
                }
                Toggle("Indie", isOn: Binding(get: { store.indie }, set: { store.indie = $0; reload() }))
                    .toggleStyle(.button).font(.caption)
            }
            .padding(.horizontal)
            .padding(.vertical, 6)
        }
        .background(.bar)
    }

    private func reload() { Task { await store.loadFeed() } }
    private var typeLabel: String {
        store.type == "movie" ? I18n.t(language, "filter.movie")
        : store.type == "tv" ? I18n.t(language, "filter.tv")
        : I18n.t(language, "filter.allTypes")
    }
    private var genreLabel: String { store.genre ?? I18n.t(language, "filter.allGenres") }
    private var toneLabel: String {
        store.tones.first { $0.slug == store.tone }?.label ?? I18n.t(language, "filter.allTones")
    }
}

/// An onboarding rate-queue tile: poster + title + stars.
private struct QueueCard: View {
    let item: RateQueueItem
    var onRate: (Double) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            PosterImage(path: item.posterPath)
            Text(item.title).font(.subheadline.weight(.semibold)).lineLimit(2, reservesSpace: true)
            RateStars(rating: nil, onRate: onRate)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.card("movie:\(item.tmdbId)"))
    }
}

private struct FilterMenu<Content: View>: View {
    let title: String
    let id: String
    @ViewBuilder var content: Content
    var body: some View {
        Menu {
            content
        } label: {
            HStack(spacing: 4) { Text(title); Image(systemName: "chevron.down") }
                .font(.caption).padding(.horizontal, 10).padding(.vertical, 6)
                .background(.quaternary, in: Capsule())
        }
        .accessibilityIdentifier(id)
    }
}

struct RetryView: View {
    let message: String
    var onRetry: () -> Void
    var body: some View {
        VStack(spacing: 12) {
            Text(message).multilineTextAlignment(.center).foregroundStyle(.secondary)
            Button("Retry", action: onRetry).buttonStyle(.borderedProminent)
                .accessibilityIdentifier(AXID.bootRetry)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
