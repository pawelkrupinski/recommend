import SwiftUI
import FilmowoCore

/// A recommendation card in the Discover / Watchlist grids: poster, service
/// icons, a "year · runtime" line, IMDb/Metacritic badges, tone chips, and
/// tap-a-star rating. Mirrors the web card and Android `PosterGrid` item.
struct CardView: View {
    let card: Card
    var enrichment: EnrichRow?
    var ratedValue: Double?
    var isSaved: Bool
    var onTap: () -> Void = {}
    var onRate: (Double) -> Void = { _ in }
    var onToggleSave: () -> Void = {}
    var onDismiss: () -> Void = {}
    /// Tapping a service logo jumps straight into that streaming app (see the
    /// call sites, which resolve the deep link and open it).
    var onTapService: (Service) -> Void = { _ in }

    @Environment(\.language) private var language
    @Environment(\.horizontalSizeClass) private var sizeClass

    private var imdb: Double? { enrichment?.imdbRating ?? card.imdbRating }
    private var meta: Int? { enrichment?.metascore ?? card.metascore }
    private var tones: [Tone] { enrichment?.tones.isEmpty == false ? enrichment!.tones : card.tones }

    /// The stars share the title+year row on a roomy (iPad / regular) width and
    /// drop to their own row below on a compact (iPhone) width.
    private var starsBesideTitle: Bool { sizeClass == .regular }

    var body: some View {
        // Everything except the stars opens the detail sheet on tap. The stars are
        // deliberately outside those tap targets so a star tap rates without also
        // opening the sheet (the stars own their touches — see RateStars).
        VStack(alignment: .leading, spacing: 6) {
            posterWithServices
                .contentShape(Rectangle())
                .onTapGesture(perform: onTap)

            if starsBesideTitle {
                HStack(alignment: .center, spacing: 8) {
                    titleAndYear
                        .contentShape(Rectangle())
                        .onTapGesture(perform: onTap)
                    stars.frame(maxWidth: 150)
                }
            } else {
                titleAndYear
                    .contentShape(Rectangle())
                    .onTapGesture(perform: onTap)
            }

            // 1.5× the stack's 6pt spacing (→9pt) above the rating pill and above
            // the tone row, so the year, rating, and tones read as separate bands.
            badgeRow.padding(.top, 3)
                .contentShape(Rectangle()).onTapGesture(perform: onTap)
            toneRow.padding(.top, 3)
                .contentShape(Rectangle()).onTapGesture(perform: onTap)

            if !starsBesideTitle {
                stars.padding(.top, 2)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.card(card.key))
    }

    private var stars: some View {
        RateStars(rating: ratedValue, onRate: onRate, rows: 1)
    }

    /// Title and year on one line — the title truncating first so the year (a
    /// separate text element that still begins with the year, which the layout
    /// UI test asserts on) always stays visible at the trailing edge.
    private var titleAndYear: some View {
        HStack(spacing: 6) {
            Text(card.title)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
            Spacer(minLength: 4)
            Text(metaLine)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .layoutPriority(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var posterWithServices: some View {
        PosterImage(path: card.posterPath)
            // Not interested → an X, top-left (styled like the sibling Kinowo app's
            // hide button: a bold glyph in a translucent black circle).
            .overlay(alignment: .topLeading) {
                cornerButton("xmark", size: 10, action: onDismiss)
                    .accessibilityIdentifier(AXID.cardDismiss)
                    .accessibilityLabel(I18n.t(language, "card.notInterested"))
                    .padding(6)
            }
            // Add to watchlist → a + (✓ once saved), top-right, like the web card.
            .overlay(alignment: .topTrailing) {
                cornerButton(isSaved ? "checkmark" : "plus", size: 12, action: onToggleSave)
                    .accessibilityIdentifier(AXID.cardSave)
                    .accessibilityLabel(I18n.t(language, isSaved ? "watchlist.remove" : "card.save"))
                    .padding(6)
            }
            // Streaming-service logos sit bottom-right; a tap opens that app.
            .overlay(alignment: .bottomTrailing) {
                HStack(spacing: 3) {
                    ForEach(card.services.prefix(3)) { svc in
                        // The innermost gesture wins, so a logo tap deep-links while
                        // taps elsewhere still open the detail sheet. Kept as the
                        // plain ServiceLogo image (not a Button) so its accessibility
                        // element stays an image, as the grid card UI test asserts.
                        ServiceLogo(service: svc)
                            .onTapGesture { onTapService(svc) }
                    }
                }
                .padding(6)
            }
    }

    /// A round translucent poster-corner control (dismiss X / watchlist +).
    private func cornerButton(_ systemImage: String, size: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: size, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 26, height: 26)
                .background(.black.opacity(0.55), in: Circle())
        }
        .buttonStyle(.plain)
    }

    private var metaLine: String {
        var parts: [String] = []
        if let y = card.year { parts.append(String(y)) }
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
            imdbPill(0).hidden() // reserve the pill's height
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
            if let imdb { imdbPill(imdb) }
            if let meta {
                Text("MC \(meta)")
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 5).padding(.vertical, 1)
                    .background(metaColor(meta), in: RoundedRectangle(cornerRadius: 4))
                    .foregroundStyle(.white)
            }
        }
    }

    /// The two-tone IMDb pill — a yellow "IMDb" tab joined to a dark value tab —
    /// matching the Android app and ../movies (colours `#F5C518` / `#2A2A3E`).
    private static let imdbYellow = Color(red: 245 / 255, green: 197 / 255, blue: 24 / 255)
    private static let pillDark = Color(red: 42 / 255, green: 42 / 255, blue: 62 / 255)

    private func imdbPill(_ value: Double) -> some View {
        HStack(spacing: 0) {
            Text("IMDb")
                .font(.caption2.weight(.black))
                .foregroundStyle(.black)
                .padding(.horizontal, 4).padding(.vertical, 2)
                .background(Self.imdbYellow)
            Text(String(format: "%.1f", value))
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Self.imdbYellow)
                .padding(.horizontal, 4).padding(.vertical, 2)
                .background(Self.pillDark)
        }
        .clipShape(RoundedRectangle(cornerRadius: 3))
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
