import SwiftUI
import FilmowoCore

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

/// A small streaming-service logo (TMDB provider icon), sized for inline use
/// next to a service name in a list row or as a card overlay. Reserves its
/// square frame even when the service has no logo path so rows stay aligned,
/// and exposes an accessibility identifier so the XCUITests can find it.
struct ServiceLogo: View {
    let service: Service
    var side: CGFloat = 22

    var body: some View {
        AsyncImage(url: TMDBImage.url(service.logo, width: 92)) { img in
            img.resizable().scaledToFit()
        } placeholder: { Color.clear }
        .frame(width: side, height: side)
        .clipShape(RoundedRectangle(cornerRadius: 5))
        .accessibilityElement()
        .accessibilityAddTraits(.isImage)
        .accessibilityLabel(service.name)
        .accessibilityIdentifier(AXID.serviceLogo(service.id))
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
