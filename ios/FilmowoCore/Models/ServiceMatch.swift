import Foundation

/// Match a card's streaming-service icon (a TMDB provider `{id, name}`) to the
/// right deep link in a title's `WhereInfo`, so tapping the logo opens the movie
/// in that app. Ported from the web `public/service-match.js` so all clients
/// resolve the same link: TMDB fragments one service into tier/reseller variants
/// and lags rebrands, so neither the id nor the raw name reliably lines up with
/// the source's plain "Paramount+" / "Max" — collapsing both sides to a brand
/// key (after preferring the server-tagged provider id) is what bridges them.

/// Lowercase; drop "+"/"plus" and non-alphanumerics. Mirrors server `norm`.
/// "Disney+" / "Disney Plus" -> "disney".
func norm(_ s: String?) -> String {
    var n = (s ?? "").lowercased()
    n = n.replacingOccurrences(of: "+", with: "")
    n = n.replacingOccurrences(of: "\\bplus\\b", with: "", options: .regularExpression)
    n = n.replacingOccurrences(of: "[^a-z0-9]", with: "", options: .regularExpression)
    return n
}

// Tier / reseller qualifiers TMDB tacks onto a service name; stripping them
// collapses every variant of one brand together.
private let variantWords = "premium|essential|standard|basic|withads|ads|amazonchannel|appletvchannel|rokuchannel|channel|kids"

/// Collapse a service name to a single brand token shared by all its TMDB
/// variants and the source's name for it. "Max" is HBO Max; Showtime now ships
/// inside Paramount+.
func brandKey(_ name: String?) -> String {
    let n = norm(name).replacingOccurrences(of: variantWords, with: "", options: .regularExpression)
    if n == "max" || n.contains("hbo") { return "hbo" }   // "Max" / "HBO Max" (not Cinemax)
    if n.contains("showtime") || n.contains("paramount") { return "paramount" }
    return n
}

public extension WhereInfo {
    /// The deep link to open for a tapped card service icon, or nil when no deep
    /// link confidently matches (the caller then falls back to `tmdbLink`).
    /// Prefer the exact server-tagged provider id, then the brand.
    func deepLink(forProviderId providerId: Int, name: String) -> String? {
        if let byId = deepLinks.first(where: { $0.providerId == providerId }) { return byId.link }
        let brand = brandKey(name)
        return deepLinks.first(where: { brandKey($0.service) == brand })?.link
    }
}
