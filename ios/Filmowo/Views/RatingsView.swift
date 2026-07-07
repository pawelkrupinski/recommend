import SwiftUI
import FilmowoCore

/// The Ratings tab: a list of everything the user has rated with the star value,
/// editable and removable. Mirrors the web ratings screen.
struct RatingsView: View {
    @ObservedObject var store: RatingsStore
    @Environment(\.language) private var language

    var body: some View {
        NavigationStack {
            Group {
                if store.loading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if store.ratings.isEmpty {
                    Text(I18n.t(language, "ratings.empty"))
                        .foregroundStyle(.secondary).padding()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .accessibilityIdentifier(AXID.ratingsEmpty)
                } else {
                    list
                }
            }
            .navigationTitle(I18n.t(language, "nav.ratings"))
            .task { await store.load() }
        }
    }

    private var list: some View {
        List {
            Section(I18n.t(language, "ratings.count", ["n": String(store.ratings.count)])) {
                ForEach(store.ratings) { rating in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(rating.title ?? "#\(rating.tmdbId)").font(.subheadline.weight(.semibold))
                        if let year = rating.year {
                            Text(String(year)).font(.caption).foregroundStyle(.secondary)
                        }
                        RateStars(rating: rating.rating) { v in
                            Task { await store.update(rating, value: v) }
                        }
                    }
                    .accessibilityIdentifier(AXID.card(rating.key))
                    .swipeActions {
                        Button(role: .destructive) {
                            Task { await store.unrate(rating) }
                        } label: { Label("Remove", systemImage: "trash") }
                    }
                }
            }
        }
    }
}
