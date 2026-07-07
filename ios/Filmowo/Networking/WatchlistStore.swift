import SwiftUI
import FilmowoCore

/// The Watchlist tab's state: saved titles with a sort (recently-added vs
/// top-rated) and type/genre filters, plus rate-to-remove. Mirrors the web
/// watchlist (`watchlist-sort.js` / `watchlist-filters.js`) and Android.
@MainActor
final class WatchlistStore: ObservableObject {
    enum Sort: String { case added, rating }

    private let client: FilmowoClient

    @Published var all: [Card] = []
    @Published var genres: [Genre] = []
    @Published var sort: Sort = .added
    @Published var type: String?
    @Published var genre: String?
    @Published var loading = true

    init(client: FilmowoClient, sort: Sort = .added) {
        self.client = client
        self.sort = sort
    }

    /// The list after applying the active filters and sort.
    var visible: [Card] {
        var items = all
        if let type { items = items.filter { $0.mediaType == type } }
        if let genre { items = items.filter { $0.genres.contains(genre) } }
        switch sort {
        case .added: return items // server order is added-at desc
        case .rating: return items.sorted { ($0.imdbRating ?? $0.voteAverage ?? 0) > ($1.imdbRating ?? $1.voteAverage ?? 0) }
        }
    }

    func load() async {
        loading = true
        if let resp = try? await client.watchlist() {
            all = resp.watchlist
            genres = resp.genres
        }
        loading = false
    }

    func setSort(_ s: Sort) {
        sort = s
        Task { try? await client.saveSettings(SettingsPayload(watchlistSort: s.rawValue)) }
    }

    func remove(_ card: Card) async {
        try? await client.removeFromWatchlist(tmdbId: card.tmdbId, mediaType: card.mediaType)
        all.removeAll { $0.key == card.key }
    }

    /// Rating a saved title moves it out of the watchlist (server + local).
    func rate(_ card: Card, value: Double) async {
        try? await client.rate(tmdbId: card.tmdbId, mediaType: card.mediaType, rating: value,
                               title: card.title, year: card.year)
        all.removeAll { $0.key == card.key }
    }

    func whereToWatch(_ card: Card) async -> WhereInfo? {
        try? await client.whereToWatch(tmdbId: card.tmdbId, mediaType: card.mediaType, region: nil)
    }
}
