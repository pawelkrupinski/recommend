import SwiftUI
import FilmowoCore

/// Where-to-watch detail, presented as a sheet over any tab (mirrors Android's
/// `DetailSheet`): poster + synopsis, director/cast, trailers, the streaming
/// services + deep links for the user's region (`/api/where`), and a
/// rate-to-remove hint.
struct DetailSheet: View {
    let card: Card
    var enrichment: EnrichRow?
    var isSaved: Bool
    var load: () async -> WhereInfo?
    var onRate: (Double) -> Void
    var onToggleSave: () -> Void

    @Environment(\.language) private var language
    @Environment(\.dismiss) private var dismiss
    @State private var whereInfo: WhereInfo?
    @State private var loading = true

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    if let overview = card.overview, !overview.isEmpty {
                        Text(overview).font(.body)
                    }
                    credits
                    whereToWatch
                    trailers
                    rateSection
                }
                .padding()
            }
            .navigationTitle(card.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(I18n.t(language, "common.close")) { dismiss() }
                        .accessibilityIdentifier(AXID.detailClose)
                }
            }
            .task {
                whereInfo = await load()
                loading = false
            }
        }
        .accessibilityIdentifier(AXID.detailSheet)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            PosterImage(path: card.posterPath).frame(width: 120)
            VStack(alignment: .leading, spacing: 6) {
                Text(metaLine).font(.subheadline).foregroundStyle(.secondary)
                if let imdb = enrichment?.imdbRating ?? card.imdbRating {
                    Label(String(format: "IMDb %.1f", imdb), systemImage: "star.fill")
                        .font(.caption).foregroundStyle(.yellow)
                }
                Button(action: onToggleSave) {
                    Label(I18n.t(language, isSaved ? "watchlist.remove" : "card.save"),
                          systemImage: isSaved ? "bookmark.fill" : "bookmark")
                }
                .buttonStyle(.bordered)
                .font(.caption)
            }
            Spacer()
        }
    }

    @ViewBuilder
    private var credits: some View {
        if let director = card.director, !director.isEmpty {
            row(I18n.t(language, "detail.director"), director)
        }
        if !card.cast.isEmpty {
            row(I18n.t(language, "detail.cast"), card.cast.prefix(6).joined(separator: ", "))
        }
    }

    @ViewBuilder
    private var whereToWatch: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(I18n.t(language, "detail.whereToWatch")).font(.headline)
            if loading {
                ProgressView()
            } else if let info = whereInfo, !info.deepLinks.isEmpty || !info.flatrate.isEmpty {
                let links = info.deepLinks
                if links.isEmpty {
                    // No deep links, but we know the subscription services.
                    Text(info.flatrate.map(\.name).joined(separator: ", ")).font(.subheadline)
                } else {
                    ForEach(links) { link in
                        if let url = URL(string: link.link) {
                            Link(destination: url) {
                                Label(link.service, systemImage: "play.circle.fill")
                            }
                        }
                    }
                }
            } else {
                Text(I18n.t(language, "detail.notAvailable")).font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var trailers: some View {
        if !card.trailers.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text(I18n.t(language, "detail.trailer")).font(.headline)
                ForEach(card.trailers.prefix(2), id: \.key) { trailer in
                    if let url = URL(string: "https://www.youtube.com/watch?v=\(trailer.key)") {
                        Link(destination: url) {
                            Label(trailer.name ?? I18n.t(language, "detail.trailer"), systemImage: "play.rectangle.fill")
                        }
                    }
                }
            }
        }
    }

    private var rateSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(I18n.t(language, "detail.watchedRate")).font(.footnote).foregroundStyle(.secondary)
            RateStars(rating: nil, onRate: onRate)
        }
    }

    private func row(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.subheadline)
        }
    }

    private var metaLine: String {
        var parts: [String] = []
        if let y = card.year { parts.append(String(y)) }
        parts.append(card.mediaType == "tv" ? I18n.t(language, "filter.tv") : I18n.t(language, "filter.movie"))
        if !card.genres.isEmpty { parts.append(card.genres.prefix(2).joined(separator: ", ")) }
        return parts.joined(separator: " · ")
    }
}
