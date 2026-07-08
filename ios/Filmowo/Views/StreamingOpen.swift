import SwiftUI
import FilmowoCore

/// Open a tapped card service logo straight in its streaming app. Fetches the
/// title's `WhereInfo`, resolves the deep link for that provider (falling back to
/// the generic TMDB page when the source has no per-service link), and opens it.
///
/// The link is an iOS Universal Link, so `openURL` hands off to the installed app
/// when present and drops to Safari otherwise — the "app-first, web fallback"
/// behaviour, for free. Shared by Discover and Watchlist so both grids behave the
/// same and the fetch/match rule lives in one place.
@MainActor
func openService(
    _ service: Service,
    where load: @escaping () async -> WhereInfo?,
    open: @escaping (URL) -> Void
) {
    Task {
        let info = await load()
        let link = info?.deepLink(forProviderId: service.id, name: service.name) ?? info?.tmdbLink
        if let link, let url = URL(string: link) { open(url) }
    }
}
