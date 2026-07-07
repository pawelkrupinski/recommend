import SwiftUI

/// Tap-a-star rating on the server's 1–10 scale, shown as five stars with
/// half-star granularity (each star is two tap targets → odd/even points).
/// Mirrors Android `RateStars`. `rating` is the current value (nil = unrated);
/// `onRate` fires the chosen 1...10 value.
struct RateStars: View {
    let rating: Double?
    var onRate: (Double) -> Void

    private let starCount = 5

    var body: some View {
        HStack(spacing: 4) {
            ForEach(1...starCount, id: \.self) { star in
                starView(star)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.rateStars)
    }

    @ViewBuilder
    private func starView(_ star: Int) -> some View {
        let value = rating ?? 0
        let symbol: String = {
            if value >= Double(star * 2) { return "star.fill" }
            if value >= Double(star * 2 - 1) { return "star.leadinghalf.filled" }
            return "star"
        }()
        Image(systemName: symbol)
            .font(.title3)
            .foregroundStyle(value >= Double(star * 2 - 1) ? Color.yellow : Color.secondary)
            .overlay {
                // Two invisible tap halves: leading = odd point, trailing = even.
                HStack(spacing: 0) {
                    tapHalf(value: star * 2 - 1)
                    tapHalf(value: star * 2)
                }
            }
    }

    private func tapHalf(value: Int) -> some View {
        Button { onRate(Double(value)) } label: {
            Color.clear.contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(AXID.rateStar(value))
        .accessibilityLabel("Rate \(value)")
    }
}
