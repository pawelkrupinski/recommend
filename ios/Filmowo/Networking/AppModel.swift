import SwiftUI
import FilmowoCore

/// Top-level app state: owns the API client and the boot flow, and exposes the
/// current `Me` + active language to the whole view tree. Mirrors the root of
/// Android `FilmowoApp.kt` — boot `/api/me`, then branch to onboarding or the
/// main tabs, with a retryable error state.
@MainActor
final class AppModel: ObservableObject {
    enum Boot: Equatable {
        case loading
        case onboarding
        case ready
        case failed
    }

    let client: FilmowoClient
    let region: AppRegionSource

    @Published var boot: Boot = .loading
    @Published var me: Me?
    /// A just-chosen language, applied instantly so the UI re-localizes without
    /// waiting for the settings round-trip; cleared once `me` catches up.
    @Published private var languageOverride: String?

    /// Active UI language: a pending override, else the user's saved choice, else
    /// the device's, else en.
    var language: String {
        languageOverride ?? me?.language ?? Locale.current.language.languageCode?.identifier ?? "en"
    }

    /// Switch language immediately (before the server confirms).
    func setLanguage(_ lang: String) {
        languageOverride = lang
        client.language = lang
    }

    init(client: FilmowoClient = .live(), region: AppRegionSource = LocationRegionSource()) {
        self.client = client
        self.region = region
        client.language = Locale.current.language.languageCode?.identifier
        client.deviceCountry = region.best()
    }

    /// Boot / re-boot: resolve region (best-effort), load `/api/me`, and route.
    func start() async {
        boot = .loading
        // A locale-based region is available immediately; a GPS refine may follow.
        client.deviceCountry = region.best()
        do {
            let me = try await client.me()
            apply(me)
            boot = me.onboarded ? .ready : .onboarding
        } catch {
            boot = .failed
        }
    }

    /// Adopt a fresh `Me` and propagate its language to outgoing requests.
    func apply(_ me: Me) {
        self.me = me
        if me.language == languageOverride { languageOverride = nil } // server caught up
        client.language = language
        if let c = me.country { client.deviceCountry = c }
    }

    /// Called when onboarding completes (server already has `onboarded=true`).
    func finishOnboarding() { boot = .ready }

    /// Refresh identity after sign-in / sign-out / settings changes, and re-route
    /// to match `me.onboarded` — so signing into an already-onboarded account on
    /// the onboarding screen lands straight on Discover (mirrors Android, which
    /// derives the screen reactively from `me`).
    func refreshMe() async {
        if let me = try? await client.me() {
            apply(me)
            boot = me.onboarded ? .ready : .onboarding
        }
    }

    func signOut() async {
        try? await client.logout()
        await start()
    }

    func deleteAccount() async {
        try? await client.deleteAccount()
        me = nil
        await start()
    }
}
