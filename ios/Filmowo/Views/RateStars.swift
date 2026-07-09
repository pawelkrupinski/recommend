import SwiftUI
import UIKit

/// Rating on the server's 1–10 scale, shown as ten stars laid out in `rows`
/// (default two rows of five; the grid card passes `rows: 1` for a single row).
/// Tap a star to rate, or — like Android `RateStars` and the web widget — drag
/// horizontally across the stars to preview the value under your finger and lift
/// to commit; with two rows, sliding down from the top row into the bottom moves
/// 1–5 up to 6–10. `rating` is the current value (nil = unrated); `onRate` fires
/// the chosen 1...10 value.
///
/// Touch handling is a UIKit layer (`StarTouchLayer`), not a SwiftUI
/// `DragGesture`: a SwiftUI drag on scroll content blocks the scroll even when
/// simultaneous, so a vertical drag starting on the stars couldn't scroll the
/// grid. The UIKit pan instead *fails* for a vertical drag (the cousin of
/// Android's `awaitHorizontalTouchSlopOrCancellation`), leaving it to the scroll
/// view, and only claims horizontal drags. XCUITest and VoiceOver still see ten
/// `rate-star-N` buttons via the star images' accessibility traits.
struct RateStars: View {
    let rating: Double?
    var onRate: (Double) -> Void

    static let starCount = 10
    var rows: Int = 2
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
            ZStack {
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
                StarTouchLayer(
                    onDragChanged: { point in preview = starAt(point, geo.size) },
                    onDragEnded: {
                        if preview > 0 { onRate(Double(preview)) }
                        preview = 0
                    },
                    onDragCancelled: { preview = 0 },
                    onTap: { point in
                        let value = starAt(point, geo.size)
                        if value > 0 { onRate(Double(value)) }
                    }
                )
            }
            .frame(width: geo.size.width, height: geo.size.height)
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
        // Ten stars across a single row need a smaller glyph to fit a narrow card.
        return Image(systemName: filled ? "star.fill" : "star")
            .font(rows == 1 ? .subheadline : .title3)
            .foregroundStyle(filled ? Color.yellow : Color.secondary)
            .frame(maxWidth: .infinity)
            // Plain image; the touch layer above handles touches. Expose each star
            // as a button to VoiceOver / XCUITest so a star can still be tapped by
            // identifier.
            .accessibilityElement()
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier(AXID.rateStar(value))
            .accessibilityLabel("Rate \(value)")
    }

    private func starAt(_ point: CGPoint, _ size: CGSize) -> Int {
        // A small slack for finger drift; drag clearly off the block → 0 (no rating).
        return Self.starAt(point.x, point.y, size.width, size.height, rows, 12)
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

/// A transparent UIKit layer that reports horizontal drags and taps on the stars
/// while leaving vertical drags to the enclosing scroll view. Locations are in
/// the layer's own coordinate space (matching the stars block).
private struct StarTouchLayer: UIViewRepresentable {
    var onDragChanged: (CGPoint) -> Void
    var onDragEnded: () -> Void
    var onDragCancelled: () -> Void
    var onTap: (CGPoint) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.backgroundColor = .clear
        let pan = HorizontalPanRecognizer(target: context.coordinator, action: #selector(Coordinator.pan(_:)))
        view.addGestureRecognizer(pan)
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tap(_:)))
        view.addGestureRecognizer(tap)
        return view
    }

    func updateUIView(_ view: UIView, context: Context) { context.coordinator.parent = self }

    final class Coordinator: NSObject {
        var parent: StarTouchLayer
        init(_ parent: StarTouchLayer) { self.parent = parent }

        @objc func pan(_ g: UIPanGestureRecognizer) {
            switch g.state {
            case .changed: parent.onDragChanged(g.location(in: g.view))
            case .ended: parent.onDragEnded()          // lift over the stars → commit
            case .cancelled, .failed: parent.onDragCancelled() // never commit
            default: break
            }
        }

        @objc func tap(_ g: UITapGestureRecognizer) {
            parent.onTap(g.location(in: g.view))
        }
    }
}

/// A pan recognizer that locks its mode by the drag's *initial* direction: once a
/// drag clears the touch slop, a predominantly-horizontal move claims it (rate
/// mode) and it never fails afterward — so you can still slide down into the
/// second row — while a predominantly-vertical move fails it, handing the drag to
/// the enclosing scroll view (so the grid scrolls even when a finger starts on
/// the stars). The cousin of Android's `awaitHorizontalTouchSlopOrCancellation`.
private final class HorizontalPanRecognizer: UIPanGestureRecognizer {
    private var start: CGPoint?
    private var locked = false
    private let slop: CGFloat = 10

    override func reset() {
        super.reset()
        start = nil
        locked = false
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesBegan(touches, with: event)
        start = touches.first?.location(in: view)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        if !locked {
            guard let start, let point = touches.first?.location(in: view) else {
                super.touchesMoved(touches, with: event); return
            }
            let dx = point.x - start.x, dy = point.y - start.y
            // Wait for the drag to clear the slop, then decide once by direction.
            if max(abs(dx), abs(dy)) < slop { return }
            locked = true
            if abs(dy) > abs(dx) { state = .failed; return } // vertical → scroll
        }
        super.touchesMoved(touches, with: event) // horizontal → rate (tracks all moves)
    }
}
