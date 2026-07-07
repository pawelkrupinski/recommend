import SwiftUI

/// Disk-first poster cache (mirrors Kinowo's `PosterStore`): one file per URL in
/// Caches, so posters survive relaunch and don't re-download. Best-effort — any
/// failure just falls back to a placeholder.
actor PosterStore {
    static let shared = PosterStore()

    private let dir: URL
    private let session = URLSession(configuration: .default)
    private var memory: [URL: Data] = [:]

    init() {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        dir = caches.appendingPathComponent("Posters", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    private func file(for url: URL) -> URL {
        // A stable, filesystem-safe name from the URL.
        let name = String(UInt64(bitPattern: Int64(url.absoluteString.hashValue)))
        return dir.appendingPathComponent(name)
    }

    func data(for url: URL) async -> Data? {
        if let cached = memory[url] { return cached }
        let path = file(for: url)
        if let onDisk = try? Data(contentsOf: path) {
            memory[url] = onDisk
            return onDisk
        }
        guard let (data, resp) = try? await session.data(from: url),
              (resp as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        memory[url] = data
        try? data.write(to: path)
        return data
    }
}

/// A disk-cached image with a placeholder, backing ``PosterImage``. Loads
/// through ``PosterStore`` so repeat displays are instant and offline-friendly.
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
