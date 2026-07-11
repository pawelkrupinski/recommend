import SwiftUI
import FilmowoCore

/// A disk-cached image with a placeholder, backing ``PosterImage``. Loads bytes
/// through ``FilmowoCore/PosterStore`` — a bounded, on-disk LRU cache — so
/// repeat displays are instant, survive relaunch, and work offline, then decodes
/// them into a `UIImage` for display.
struct CachedAsyncImage<Placeholder: View>: View {
    let url: URL?
    @ViewBuilder var placeholder: () -> Placeholder

    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: .fill)
            } else {
                placeholder()
            }
        }
        .task(id: url) {
            guard let url else { image = nil; return }
            if let data = await PosterStore.shared.data(for: url), let ui = UIImage(data: data) {
                image = ui
            }
        }
    }
}
