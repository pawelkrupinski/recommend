import Foundation

/// Centralized accessibility identifiers that drive the XCUITests (mirrors
/// Kinowo's `AccessibilityIdentifiers`). Keeping them in one place keeps the
/// tests and the views from drifting apart.
enum AXID {
    // Boot / nav
    static let bootRetry = "boot-retry"
    static let tabDiscover = "tab-discover"
    static let tabWatchlist = "tab-watchlist"
    static let tabRatings = "tab-ratings"
    static let tabSettings = "tab-settings"

    // Onboarding
    static let onboardingStart = "onboarding-start"
    static let onboardingSignIn = "onboarding-signin"
    static let onboardingLanguage = "onboarding-language"

    // Discover
    static let discoverGrid = "discover-grid"
    static let discoverBuilding = "discover-building"
    static let discoverFilterType = "discover-filter-type"
    static let discoverFilterGenre = "discover-filter-genre"
    static let discoverRefresh = "discover-refresh"
    static func card(_ key: String) -> String { "card-\(key)" }

    // Rating
    static let rateStars = "rate-stars"
    static func rateStar(_ value: Int) -> String { "rate-star-\(value)" }

    // Card actions
    static let cardSave = "card-save"
    static let cardDismiss = "card-dismiss"
    static let cardNotSeen = "card-not-seen"

    // Detail
    static let detailSheet = "detail-sheet"
    static let detailClose = "detail-close"

    // Settings
    static let settingsLanguage = "settings-language"
    static let settingsCountry = "settings-country"
    static let settingsSignOut = "settings-signout"
    static let settingsDelete = "settings-delete"

    // Watchlist / ratings
    static let watchlistSort = "watchlist-sort"
    static let watchlistEmpty = "watchlist-empty"
    static let ratingsEmpty = "ratings-empty"
}
