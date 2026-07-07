import SwiftUI

/// Entry point for the Filmowo iOS client (iPhone + iPad).
///
/// Mirrors the Android app (`android/`) and web (`public/app.js`): a single
/// window that boots against the server, then shows onboarding or the main
/// tabbed experience. The real navigation lands in a later slice; this is the
/// compiling skeleton.
@main
struct FilmowoApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}
