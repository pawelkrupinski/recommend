import SwiftUI

/// Builds TMDB poster URLs and renders them with a placeholder. Server payloads
/// carry a bare `poster_path` (e.g. `/matrix.jpg`); the app prefixes the TMDB
/// image CDN base, matching the web app and Android (Coil). A disk-caching
/// `PosterStore` layers on in a later slice; `AsyncImage` handles the memory
/// cache for now.
enum TMDBImage {
    static let base = "https://image.tmdb.org/t/p"

    static func url(_ posterPath: String?, width: Int = 500) -> URL? {
        guard let p = posterPath, !p.isEmpty else { return nil }
        return URL(string: "\(base)/w\(width)\(p)")
    }
}

/// A poster with a rounded placeholder while loading or when absent.
struct PosterImage: View {
    let path: String?
    var width: Int = 500

    var body: some View {
        CachedAsyncImage(url: TMDBImage.url(path, width: width)) {
            ZStack {
                Rectangle().fill(.quaternary)
                Image(systemName: "film")
                    .font(.title2)
                    .foregroundStyle(.tertiary)
            }
        }
        .aspectRatio(2.0 / 3.0, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}
