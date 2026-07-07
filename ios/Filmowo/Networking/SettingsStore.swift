import SwiftUI
import FilmowoCore

/// The Settings tab's state: account (sign in/out, delete), country, streaming
/// services, and interface language — each change persisted to `/api/settings`.
/// Mirrors Android's settings screen. Language changes flow back through
/// `AppModel` so the whole UI re-localizes.
@MainActor
final class SettingsStore: ObservableObject {
    private let app: AppModel
    private let auth = AuthService()

    @Published var providers: [Service] = []
    @Published var selectedServices: Set<Int> = []
    @Published var country: String = "US"
    @Published var language: String = "en"
    @Published var loadingProviders = false

    init(app: AppModel) {
        self.app = app
        syncFromMe()
    }

    var me: Me? { app.me }
    var isSignedIn: Bool { !(app.me?.anonymous ?? true) }
    var availableProviders: [String] { app.me?.providers ?? [] }

    private func syncFromMe() {
        country = app.me?.country ?? app.me?.detectedCountry ?? app.region.best() ?? "US"
        language = app.me?.language ?? "en"
        selectedServices = Set(app.me?.services ?? [])
    }

    func load() async {
        syncFromMe()
        await loadProviders()
    }

    func loadProviders() async {
        loadingProviders = true
        providers = (try? await app.client.providers(region: country))?.providers ?? []
        loadingProviders = false
    }

    func changeCountry(_ code: String) async {
        country = code
        app.client.deviceCountry = code
        await loadProviders()
        await save()
    }

    func toggleService(_ id: Int) {
        if selectedServices.contains(id) { selectedServices.remove(id) } else { selectedServices.insert(id) }
        Task { await save() }
    }

    func changeLanguage(_ lang: String) async {
        language = lang
        app.setLanguage(lang) // re-localizes the whole tree instantly
        await save()
        await app.refreshMe()
    }

    private func save() async {
        try? await app.client.saveSettings(SettingsPayload(
            country: country, providers: Array(selectedServices), language: language))
    }

    func signIn(provider: String) async {
        do {
            try await auth.signIn(provider: provider, client: app.client)
            await app.refreshMe()
            syncFromMe()
        } catch { /* cancelled/failed */ }
    }

    func signOut() async {
        await app.signOut()
    }

    func deleteAccount() async {
        await app.deleteAccount()
    }
}
