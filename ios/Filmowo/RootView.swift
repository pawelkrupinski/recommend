import SwiftUI

/// Placeholder root. Replaced in the networking/onboarding slice with the
/// `/api/me` boot probe → onboarding vs. the four-tab main scaffold
/// (Discover, Watchlist, Ratings, Settings), matching Android `FilmowoApp.kt`.
struct RootView: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "film.stack")
                .font(.system(size: 56))
                .foregroundStyle(.tint)
            Text("Filmowo")
                .font(.largeTitle.bold())
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

#Preview {
    RootView()
}
