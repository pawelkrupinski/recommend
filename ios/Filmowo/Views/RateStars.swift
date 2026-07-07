import SwiftUI

/// Rating on the server's 1–10 scale, shown as ten stars in two rows of five.
/// Tap a star to rate, or — like Android `RateStars` and the web widget — drag
/// horizontally across the stars to preview the value under your finger and lift
/// to commit; sliding down from the top row into the bottom moves 1–5 up to
/// 6–10. `rating` is the current value (nil = unrated); `onRate` fires the
/// chosen 1...10 value.
///
/// One `DragGesture` on the whole block handles both tap and drag: the stars are
/// plain (accessibility-only) images rather than buttons, because a per-star
/// `Button` swallows the touch sequence and the drag never reaches the block
/// (most visibly on iPad). XCUITest and VoiceOver still see ten `rate-star-N`
/// buttons via the accessibility traits.
struct RateStars: View {
    let rating: Double?
    var onRate: (Double) -> Void

    static let starCount = 10
    private let rows = 2
    private var perRow: Int { Self.starCount / rows }
    /// Fixed row height so the `GeometryReader` reports a stable block size.
    private let rowHeight: CGFloat = 30

    /// Value under the finger during a drag (0 = none / not dragging).
    @State private var preview = 0

    private var displayValue: Int {
        preview > 0 ? preview : Int((rating ?? 0).rounded())
    }

    var body: some View {
        GeometryReader { geo in
            VStack(spacing: 0) {
                ForEach(0..<rows, id: \.self) { row in
                    HStack(spacing: 0) {
                        ForEach(0..<perRow, id: \.self) { col in
                            star(row * perRow + col + 1)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .contentShape(Rectangle())
            .gesture(dragToRate(size: geo.size))
            .overlay(alignment: .topTrailing) {
                if preview > 0 {
                    Text("\(preview)/10")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.yellow)
                        .offset(y: -18)
                }
            }
        }
        .frame(height: rowHeight * CGFloat(rows))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.rateStars)
    }

    private func star(_ value: Int) -> some View {
        let filled = value <= displayValue
        return Image(systemName: filled ? "star.fill" : "star")
            .font(.title3)
            .foregroundStyle(filled ? Color.yellow : Color.secondary)
            .frame(maxWidth: .infinity)
            // Plain image; the block's drag gesture handles touches. Expose each
            // star as a button to VoiceOver / XCUITest so a star can still be
            // tapped by identifier.
            .accessibilityElement()
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier(AXID.rateStar(value))
            .accessibilityLabel("Rate \(value)")
    }

    private func dragToRate(size: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .local)
            .onChanged { g in
                // A vertical-dominant move is a cancel (slide off), not a rating.
                guard abs(g.translation.width) >= abs(g.translation.height) else {
                    preview = 0
                    return
                }
                let vSlop = size.height / CGFloat(rows) * 3
                preview = Self.starAt(g.location.x, g.location.y, size.width, size.height, rows, vSlop)
            }
            .onEnded { _ in
                if preview > 0 { onRate(Double(preview)) }
                preview = 0
            }
    }

    /// The star (1...`starCount`) a touch at (`x`,`y`) falls on within a
    /// `width`×`height` block of `rows` equal rows, or 0 when it's outside — off
    /// the left/right ends, or away vertically past `vSlop`. The row picks 1–5 vs
    /// 6–10; the column picks within it. Mirrors Android `starAt`.
    static func starAt(_ x: CGFloat, _ y: CGFloat, _ width: CGFloat, _ height: CGFloat, _ rows: Int, _ vSlop: CGFloat) -> Int {
        guard width > 0, height > 0 else { return 0 }
        guard x >= 0, x <= width else { return 0 }
        guard y >= -vSlop, y <= height + vSlop else { return 0 }
        let perRow = starCount / rows
        let row = min(max(Int(y / (height / CGFloat(rows))), 0), rows - 1)
        let col = min(max(Int((x / width) * CGFloat(perRow)), 0), perRow - 1)
        return row * perRow + col + 1
    }
}
