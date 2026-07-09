import SwiftUI
import FilmowoCore

/// The Ratings tab: a list of everything the user has rated with the star value,
/// editable and removable. Mirrors the web ratings screen.
struct RatingsView: View {
    @ObservedObject var store: RatingsStore
    @Environment(\.language) private var language
    @Environment(\.horizontalSizeClass) private var sizeClass

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
                    HStack(alignment: .center, spacing: 8) {
                        ratingContent(rating)
                            // Keep the row (card) identifier on the text/stars content
                            // only — applied to the whole row it overrides the remove
                            // button's own identifier, hiding it from the tests.
                            .accessibilityIdentifier(AXID.card(rating.key))
                        Spacer(minLength: 8)
                        removeButton(rating)
                    }
                    .swipeActions {
                        Button(role: .destructive) {
                            Task { await store.unrate(rating) }
                        } label: { Label(I18n.t(language, "ratings.remove"), systemImage: "trash") }
                    }
                }
            }
        }
    }

    /// Title + year on one line, with all ten stars in a single row: beside the
    /// title on a roomy iPad width, or on the row below it on a compact iPhone.
    @ViewBuilder
    private func ratingContent(_ rating: Rating) -> some View {
        let stars = RateStars(rating: rating.rating, onRate: { v in
            Task { await store.update(rating, value: v) }
        }, rows: 1, showsValue: true)
        if sizeClass == .regular {
            HStack(alignment: .center, spacing: 12) {
                titleAndYear(rating)
                Spacer(minLength: 12)
                stars.frame(maxWidth: 240)
            }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                titleAndYear(rating)
                stars
            }
        }
    }

    private func titleAndYear(_ rating: Rating) -> some View {
        HStack(spacing: 6) {
            Text(rating.title ?? "#\(rating.tmdbId)")
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
            if let year = rating.year {
                Text(String(year)).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    /// A visible per-row remove control (alongside the swipe-to-remove action), so
    /// a rating can be deleted without discovering the swipe gesture.
    private func removeButton(_ rating: Rating) -> some View {
        Button(role: .destructive) {
            Task { await store.unrate(rating) }
        } label: {
            Image(systemName: "trash").foregroundStyle(.red)
        }
        .buttonStyle(.borderless)
        .accessibilityIdentifier(AXID.ratingRemove(rating.key))
        .accessibilityLabel(I18n.t(language, "ratings.remove"))
    }
}
