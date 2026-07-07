import Foundation

/// The streaming-region country source the app depends on — a seam so tests (and
/// the SwiftUI layer) can swap in a fake without CoreLocation. The CoreLocation
/// implementation lives in the app target (`Location/`); this Foundation-only
/// core holds the pure selection logic and the locale-based fallback.
///
/// This is deliberately about location, not language: a Canadian-English phone in
/// Poland should report `PL` here so picks are streamable locally, while the UI
/// language follows a separate setting (carried on `Accept-Language`). Mirrors
/// Android `RegionSource` / `DeviceRegion`.
public protocol RegionSource {
    /// Best country code known right now (ISO-3166 alpha-2, uppercase), or nil.
    func best() -> String?
}

public enum RegionResolver {
    /// First well-formed 2-letter country among the candidates, trimmed and
    /// uppercased. Pure — mirrors Android `DeviceRegion.pickCountry`.
    public static func pickCountry(_ candidates: String?...) -> String? {
        pickCountry(candidates)
    }

    public static func pickCountry(_ candidates: [String?]) -> String? {
        for candidate in candidates {
            guard let raw = candidate?.trimmingCharacters(in: .whitespaces).uppercased() else { continue }
            if raw.count == 2 && raw.allSatisfy({ $0.isLetter }) { return raw }
        }
        return nil
    }
}

/// Fallback region from the device locale — works everywhere including Linux
/// (`swift test`). The app layers a CoreLocation GPS override on top of this.
public struct LocaleRegionSource: RegionSource {
    private let localeRegion: String?

    public init(localeRegion: String? = Locale.current.region?.identifier) {
        self.localeRegion = localeRegion
    }

    public func best() -> String? { RegionResolver.pickCountry(localeRegion) }
}
