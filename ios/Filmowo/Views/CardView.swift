import SwiftUI
import FilmowoCore

/// A recommendation card in the Discover / Watchlist grids: poster, service
/// icons, a "year · ⭐rating · runtime" line, IMDb/Metacritic badges, tone chips,
/// and tap-a-star rating. Mirrors the web card and Android `PosterGrid` item.
struct CardView: View {
    let card: Card
    var enrichment: EnrichRow?
    var ratedValue: Double?
    var isSaved: Bool
    var onTap: () -> Void = {}
    var onRate: (Double) -> Void = { _ in }
    var onToggleSave: () -> Void = {}
    var onDismiss: () -> Void = {}
    var onNotSeen: () -> Void = {}

    @Environment(\.language) private var language

    private var imdb: Double? { enrichment?.imdbRating ?? card.imdbRating }
    private var meta: Int? { enrichment?.metascore ?? card.metascore }
    private var tones: [Tone] { enrichment?.tones.isEmpty == false ? enrichment!.tones : card.tones }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            posterWithServices
                .onTapGesture(perform: onTap)

            Text(card.title)
                .font(.subheadline.weight(.semibold))
                .lineLimit(2, reservesSpace: true)

            Text(metaLine)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)

            if imdb != nil || meta != nil { badges }
            if !tones.isEmpty { toneChips }

            RateStars(rating: ratedValue, onRate: onRate)
                .padding(.top, 2)
        }
        .accessibilityIdentifier(AXID.card(card.key))
    }

    private var posterWithServices: some View {
        PosterImage(path: card.posterPath)
            .overlay(alignment: .topTrailing) {
                HStack(spacing: 3) {
                    ForEach(card.services.prefix(3)) { svc in
                        AsyncImage(url: TMDBImage.url(svc.logo, width: 92)) { img in
                            img.resizable().scaledToFit()
                        } placeholder: { Color.clear }
                        .frame(width: 22, height: 22)
                        .clipShape(RoundedRectangle(cornerRadius: 5))
                    }
                }
                .padding(6)
            }
            .overlay(alignment: .bottomTrailing) { actionMenu.padding(6) }
    }

    private var actionMenu: some View {
        HStack(spacing: 6) {
            Button(action: onToggleSave) {
                Image(systemName: isSaved ? "bookmark.fill" : "bookmark")
                    .padding(6)
                    .background(.thinMaterial, in: Circle())
            }
            .accessibilityIdentifier(AXID.cardSave)

            Menu {
                Button(I18n.t(language, "card.notInterested"), systemImage: "hand.thumbsdown", action: onDismiss)
                Button(I18n.t(language, "card.notSeen"), systemImage: "eye.slash", action: onNotSeen)
            } label: {
                Image(systemName: "ellipsis")
                    .padding(6)
                    .background(.thinMaterial, in: Circle())
            }
            .accessibilityIdentifier(AXID.cardDismiss)
        }
        .font(.caption)
        .foregroundStyle(.primary)
    }

    private var metaLine: String {
        var parts: [String] = []
        if let y = card.year { parts.append(String(y)) }
        if let v = card.voteAverage, v > 0 { parts.append("⭐ \(String(format: "%.1f", v))") }
        if card.mediaType == "tv", let s = card.seasons {
            parts.append(s == 1 ? "1 season" : "\(s) seasons")
        } else if let r = card.runtime, r > 0 {
            parts.append("\(r) min")
        }
        return parts.joined(separator: " · ")
    }

    private var badges: some View {
        HStack(spacing: 6) {
            if let imdb {
                Label(String(format: "%.1f", imdb), systemImage: "star.circle.fill")
                    .labelStyle(.titleAndIcon)
                    .foregroundStyle(.yellow)
            }
            if let meta {
                Text("MC \(meta)")
                    .padding(.horizontal, 5).padding(.vertical, 1)
                    .background(metaColor(meta), in: RoundedRectangle(cornerRadius: 4))
                    .foregroundStyle(.white)
            }
        }
        .font(.caption2.weight(.semibold))
    }

    private func metaColor(_ score: Int) -> Color {
        score >= 61 ? .green : (score >= 40 ? .orange : .red)
    }

    private var toneChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(tones.prefix(3)) { tone in
                    Text(tone.label)
                        .font(.caption2)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(.quaternary, in: Capsule())
                }
            }
        }
    }
}
