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

            Text(card.title)
                .font(.subheadline.weight(.semibold))
                .lineLimit(2, reservesSpace: true)

            Text(metaLine)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)

            badgeRow
            toneRow

            RateStars(rating: ratedValue, onRate: onRate)
                .padding(.top, 2)
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onTap)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.card(card.key))
    }

    private var posterWithServices: some View {
        PosterImage(path: card.posterPath)
            .overlay(alignment: .topTrailing) {
                HStack(spacing: 3) {
                    ForEach(card.services.prefix(3)) { svc in
                        ServiceLogo(service: svc)
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

    /// The ratings badges, but always occupying a fixed height (a hidden template
    /// badge reserves it) so cards with and without ratings stay the same height
    /// and their stars, poster tops, and year lines all line up across the grid.
    private var badgeRow: some View {
        ZStack(alignment: .leading) {
            Label("0.0", systemImage: "star.circle.fill")
                .labelStyle(.titleAndIcon)
                .font(.caption2.weight(.semibold))
                .hidden()
            if imdb != nil || meta != nil { badges }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The tone chips, likewise reserving a fixed row height even when absent.
    private var toneRow: some View {
        ZStack(alignment: .leading) {
            Text("Tone").font(.caption2).padding(.vertical, 2).hidden()
            if !tones.isEmpty { toneChips }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
