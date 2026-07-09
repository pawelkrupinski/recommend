import SwiftUI
import FilmowoCore

/// The Ratings tab's state: every title the user has rated, newest first, with
/// un-rate. Mirrors the web ratings screen and Android.
@MainActor
final class RatingsStore: ObservableObject {
    private let client: FilmowoClient

    @Published var ratings: [Rating] = []
    @Published var loading = true

    init(client: FilmowoClient) { self.client = client }

    func load() async {
        // Only blank to a spinner on the first load; a refresh keeps the list
        // visible (the screen re-runs this each time it slides back into view).
        if ratings.isEmpty { loading = true }
        ratings = (try? await client.ratings())?.ratings ?? []
        loading = false
    }

    func unrate(_ rating: Rating) async {
        try? await client.unrate(tmdbId: rating.tmdbId, mediaType: rating.mediaType)
        ratings.removeAll { $0.key == rating.key }
    }

    func update(_ rating: Rating, value: Double) async {
        try? await client.rate(tmdbId: rating.tmdbId, mediaType: rating.mediaType, rating: value,
                               title: rating.title, year: rating.year)
        if let i = ratings.firstIndex(where: { $0.key == rating.key }) {
            ratings[i] = Rating(tmdbId: rating.tmdbId, mediaType: rating.mediaType, rating: value,
                                title: rating.title, year: rating.year, source: rating.source, ratedAt: rating.ratedAt)
        }
    }
}
