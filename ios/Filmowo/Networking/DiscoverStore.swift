import SwiftUI
import FilmowoCore

/// Discover's adaptive state, mirroring the web app (`public/app.js`): a brand-new
/// account (fewer than `rateGoal` rated films) is onboarded with a grid of
/// acclaimed titles to rate; at/above the goal it shows personalized picks (with
/// a "Building your picks…" state while the engine warms up).
@MainActor
final class DiscoverStore: ObservableObject {
    enum Phase: Equatable { case loading, onboarding, building, picks, empty, error }

    /// Mirrors `RATE_GOAL` in the server (`taste.js`) and web frontend.
    static let rateGoal = 10

    private let client: FilmowoClient

    @Published var phase: Phase = .loading
    /// True while a filter change or refresh reloads picks that are already on
    /// screen — the grid stays visible (phase stays `.picks`) so the view shows an
    /// inline spinner rather than blanking to the full-screen loading state.
    @Published var reloading = false
    @Published var picks: [Card] = []
    @Published var queue: [RateQueueItem] = []
    @Published var leftToRate = rateGoal
    @Published var profileSize = 0

    // Filter bar
    @Published var genres: [Genre] = []
    @Published var tones: [Tone] = []
    @Published var type: String?
    @Published var genre: String?
    @Published var tone: String?
    @Published var indie = false
    @Published var excludeUs = false

    // Local membership, so the grid reflects actions without a round-trip.
    @Published private(set) var ratedKeys: Set<String> = []
    @Published private(set) var watchlistKeys: Set<String> = []
    /// Async-resolved IMDb/Metacritic badges + tones, keyed by `media_type:id`.
    @Published private(set) var enrichment: [String: EnrichRow] = [:]

    private var catalogLoaded = false
    private var queuePage = 1
    private var queueTotalPages = 1
    private var enrichTask: Task<Void, Never>?

    init(client: FilmowoClient) { self.client = client }

    private var query: RecommendQuery {
        RecommendQuery(type: type, genre: genre, tag: tone, indie: indie, excludeUs: excludeUs)
    }

    /// First load: catalog + membership once, then the feed. Re-run each time the
    /// screen slides back into view, so skip it once we already have a feed —
    /// otherwise every return to Discover would re-dim and refetch the grid.
    func loadInitial() async {
        if catalogLoaded && (!picks.isEmpty || !queue.isEmpty) { return }
        if !catalogLoaded {
            async let g = client.genres()
            async let t = client.tones()
            async let r = client.ratings()
            async let w = client.watchlist()
            genres = (try? await g)?.genres ?? []
            tones = (try? await t)?.tones ?? []
            ratedKeys = Set(((try? await r)?.ratings ?? []).map(\.key))
            watchlistKeys = Set(((try? await w)?.watchlist ?? []).map(\.key))
            catalogLoaded = true
        }
        await loadFeed()
    }

    /// Fetch `/api/recommend` and route to onboarding / building / picks.
    func loadFeed(refresh: Bool = false) async {
        if picks.isEmpty && queue.isEmpty { phase = .loading } else { reloading = true }
        defer { reloading = false }
        var q = query; q.refresh = refresh
        do {
            let recs = try await client.recommend(q)
            profileSize = recs.profileSize
            if recs.profileSize >= Self.rateGoal {
                picks = recs.results
                queue = []
                phase = recs.results.isEmpty ? .building : .picks
                startEnrich()
            } else {
                await loadQueue(reset: true)
                leftToRate = max(0, Self.rateGoal - recs.profileSize)
                phase = queue.isEmpty ? .empty : .onboarding
            }
        } catch {
            phase = (picks.isEmpty && queue.isEmpty) ? .error : phase
        }
    }

    // MARK: - Onboarding rate queue

    private func loadQueue(reset: Bool) async {
        if reset { queuePage = 1; queue = [] }
        guard let rq = try? await client.rateQueue(page: queuePage) else { return }
        queueTotalPages = rq.totalPages
        // Don't re-show titles the user already rated.
        let fresh = rq.items.filter { !ratedKeys.contains("movie:\($0.tmdbId)") }
        queue.append(contentsOf: fresh)
    }

    private func topUpQueueIfNeeded() async {
        guard queue.count < 4, queuePage < queueTotalPages else { return }
        queuePage += 1
        await loadQueue(reset: false)
    }

    /// Rate an onboarding-queue title; advance toward the goal, and cross over to
    /// picks once it's reached.
    func rateQueueItem(_ item: RateQueueItem, value: Double) async {
        try? await client.rate(tmdbId: item.tmdbId, mediaType: "movie", rating: value,
                               title: item.title, year: item.year)
        ratedKeys.insert("movie:\(item.tmdbId)")
        queue.removeAll { $0.tmdbId == item.tmdbId }
        profileSize += 1
        leftToRate = max(0, Self.rateGoal - profileSize)
        if profileSize >= Self.rateGoal {
            await loadFeed()
        } else {
            await topUpQueueIfNeeded()
            if queue.isEmpty { phase = .building; await loadFeed() }
        }
    }

    // MARK: - Pick actions

    func rate(_ card: Card, value: Double) async {
        try? await client.rate(tmdbId: card.tmdbId, mediaType: card.mediaType, rating: value,
                               title: card.title, year: card.year)
        ratedKeys.insert(card.key)
        picks.removeAll { $0.key == card.key } // rating a pick moves it out of the feed
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
        picks.removeAll { $0.key == card.key }
    }

    // MARK: - Enrichment stream

    private func startEnrich() {
        enrichTask?.cancel()
        let cards = picks.filter { enrichment[$0.key] == nil }
        guard !cards.isEmpty else { return }
        enrichTask = Task {
            do {
                for try await row in client.enrich(cards) {
                    if Task.isCancelled { break }
                    enrichment[row.key] = row
                }
            } catch {
                // Enrichment is best-effort — a dropped stream just leaves badges unfilled.
            }
        }
    }

    func enrichment(for card: Card) -> EnrichRow? { enrichment[card.key] }

    /// Where-to-watch for the detail sheet (server picks the region from the
    /// session / `X-Device-Country`).
    func whereToWatch(_ card: Card) async -> WhereInfo? {
        try? await client.whereToWatch(tmdbId: card.tmdbId, mediaType: card.mediaType, region: nil)
    }
}
