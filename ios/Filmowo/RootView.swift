import SwiftUI
import FilmowoCore

/// App root: boots against `/api/me`, then routes to onboarding or the main
/// tabs, with a retryable error state. Owns the `AppModel` and injects it +
/// the active language into the whole tree. Mirrors Android `FilmowoApp.kt`.
struct RootView: View {
    @StateObject private var app = AppModel()

    var body: some View {
        Group {
            switch app.boot {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failed:
                RetryView(message: I18n.t(app.language, "error.offline")) {
                    Task { await app.start() }
                }
            case .onboarding:
                OnboardingView(app: app)
            case .ready:
                MainTabView(app: app)
            }
        }
        .environmentObject(app)
        .language(app.language)
        .task {
            if app.me == nil { await app.start() }
        }
    }
}
