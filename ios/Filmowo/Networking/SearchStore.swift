import SwiftUI
import FilmowoCore

/// The floating search screen's state: a debounced title search over
/// `/api/search`, whose results are the same ``Card`` grid as Discover (an empty
/// `services` means the title isn't on the user's chosen streaming services). The
/// rate / watchlist / dismiss actions delegate to the same `FilmowoClient`
/// methods `DiscoverStore` uses, so search and Discover share one set of rules.
@MainActor
final class SearchStore: ObservableObject {
    enum Phase: Equatable { case idle, loading, results, empty, error }

    private let client: FilmowoClient

    /// Bound to the search field; typing (re)triggers the debounced `search()`.
    @Published var query = ""
    @Published var phase: Phase = .idle
    @Published var results: [Card] = []

    // Local membership, so the grid reflects actions without a round-trip —
    // mirrors DiscoverStore.
    @Published private(set) var ratedKeys: Set<String> = []
    @Published private(set) var watchlistKeys: Set<String> = []
    /// Async-resolved IMDb/Metacritic badges + tones, keyed by `media_type:id`.
    @Published private(set) var enrichment: [String: EnrichRow] = [:]

    private var membershipLoaded = false
    private var debounceTask: Task<Void, Never>?
    private var enrichTask: Task<Void, Never>?

    init(client: FilmowoClient) { self.client = client }

    /// Load rating/watchlist membership once, so result cards show their saved /
    /// rated state (the same seam DiscoverStore uses on first load).
    func loadMembership() async {
        guard !membershipLoaded else { return }
        async let r = client.ratings()
        async let w = client.watchlist()
        ratedKeys = Set(((try? await r)?.ratings ?? []).map(\.key))
        watchlistKeys = Set(((try? await w)?.watchlist ?? []).map(\.key))
        membershipLoaded = true
    }

    /// Debounced (~300ms) search: cancel any pending run, wait for the typing to
    /// settle, then hit `/api/search`. An empty query clears back to idle.
    func search() {
        debounceTask?.cancel()
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else {
            enrichTask?.cancel()
            results = []
            phase = .idle
            return
        }
        debounceTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            phase = results.isEmpty ? .loading : phase
            do {
                let found = try await client.search(q)
                guard !Task.isCancelled else { return }
                results = found
                phase = found.isEmpty ? .empty : .results
                startEnrich()
            } catch {
                guard !Task.isCancelled else { return }
                phase = results.isEmpty ? .error : phase
            }
        }
    }

    // MARK: - Result actions (delegating to the same client methods as Discover)

    func rate(_ card: Card, value: Double) async {
        try? await client.rate(tmdbId: card.tmdbId, mediaType: card.mediaType, rating: value,
                               title: card.title, year: card.year)
        ratedKeys.insert(card.key)
        results.removeAll { $0.key == card.key } // rating a result moves it out
    }

    func toggleWatchlist(_ card: Card) async {
        if watchlistKeys.contains(card.key) {
            try? await client.removeFromWatchlist(tmdbId: card.tmdbId, mediaType: card.mediaType)
            watchlistKeys.remove(card.key)
        } else {
            try? await client.addToWatchlist(card)
            watchlistKeys.insert(card.key)
        }
    }

    func dismiss(_ card: Card) async {
        try? await client.dismiss(tmdbId: card.tmdbId, mediaType: card.mediaType)
        results.removeAll { $0.key == card.key }
    }

    // MARK: - Enrichment stream (same best-effort badge fill as Discover)

    private func startEnrich() {
        enrichTask?.cancel()
        let cards = results.filter { enrichment[$0.key] == nil }
        guard !cards.isEmpty else { return }
        enrichTask = Task {
            do {
                for try await row in client.enrich(cards) {
                    if Task.isCancelled { break }
                    enrichment[row.key] = row
                }
            } catch {
                // Best-effort — a dropped stream just leaves badges unfilled.
            }
        }
    }

    func enrichment(for card: Card) -> EnrichRow? { enrichment[card.key] }

    /// Where-to-watch for the detail sheet / service-logo deep link (server picks
    /// the region from the session / `X-Device-Country`).
    func whereToWatch(_ card: Card) async -> WhereInfo? {
        try? await client.whereToWatch(tmdbId: card.tmdbId, mediaType: card.mediaType, region: nil)
    }
}
