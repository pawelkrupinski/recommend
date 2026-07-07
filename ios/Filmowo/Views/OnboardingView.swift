import SwiftUI
import FilmowoCore

/// First-run onboarding, mirroring Android `OnboardingScreen`: pick language,
/// resolve/choose country (optionally from location), choose streaming services,
/// optionally sign in, then complete (server marks `onboarded=true`).
@MainActor
final class OnboardingModel: ObservableObject {
    @Published var language: String
    @Published var country: String
    @Published var providers: [Service] = []
    @Published var selectedServices: Set<Int> = []
    @Published var loadingProviders = false
    @Published var locating = false
    @Published var saving = false
    @Published var signedIn = false

    private let app: AppModel
    private let auth = AuthService()

    init(app: AppModel) {
        self.app = app
        let me = app.me
        self.language = me?.language ?? Locale.current.language.languageCode?.identifier ?? "en"
        self.country = me?.country ?? me?.detectedCountry ?? app.region.best() ?? "US"
        self.selectedServices = Set(me?.services ?? [])
        self.signedIn = !(me?.anonymous ?? true)
    }

    func onAppear() async { await loadProviders() }

    func loadProviders() async {
        loadingProviders = true
        providers = (try? await app.client.providers(region: country))?.providers ?? []
        loadingProviders = false
    }

    func useLocation() async {
        locating = true
        if let code = await app.region.resolveGPS(geocode: { lat, lng in
            try await self.app.client.geocode(lat: lat, lng: lng)
        }) {
            country = code
            app.client.deviceCountry = code
            await loadProviders()
        }
        locating = false
    }

    func changeCountry(_ code: String) async {
        country = code
        app.client.deviceCountry = code
        selectedServices = []
        await loadProviders()
    }

    func toggle(_ id: Int) {
        if selectedServices.contains(id) { selectedServices.remove(id) } else { selectedServices.insert(id) }
    }

    func signIn(provider: String) async {
        do {
            try await auth.signIn(provider: provider, client: app.client)
            await app.refreshMe()
            signedIn = !(app.me?.anonymous ?? true)
            // Adopt the account's saved prefs if it had any.
            if let me = app.me {
                if let c = me.country { country = c }
                if !me.services.isEmpty { selectedServices = Set(me.services) }
            }
        } catch { /* cancelled or failed — stay on the screen */ }
    }

    func complete() async {
        saving = true
        try? await app.client.saveSettings(SettingsPayload(
            country: country,
            providers: Array(selectedServices),
            language: language,
            onboarded: true))
        app.client.language = language
        await app.refreshMe()
        saving = false
        app.finishOnboarding()
    }
}

struct OnboardingView: View {
    @EnvironmentObject private var app: AppModel
    @StateObject private var model: OnboardingModel

    init(app: AppModel) {
        _model = StateObject(wrappedValue: OnboardingModel(app: app))
    }

    private var language: String { model.language }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(I18n.t(language, "onboarding.intro"))
                        .foregroundStyle(.secondary)
                }
                languageSection
                countrySection
                servicesSection
                accountSection
                Section {
                    Button {
                        Task { await model.complete() }
                    } label: {
                        HStack {
                            Spacer()
                            if model.saving { ProgressView() } else { Text(I18n.t(language, "onboarding.start")) }
                            Spacer()
                        }
                    }
                    .disabled(model.saving)
                    .accessibilityIdentifier(AXID.onboardingStart)
                }
            }
            .navigationTitle(I18n.t(language, "onboarding.welcome"))
            .task { await model.onAppear() }
        }
    }

    private var languageSection: some View {
        Section(I18n.t(language, "settings.language")) {
            Picker(I18n.t(language, "settings.language"), selection: $model.language) {
                Text("English").tag("en")
                Text("Polski").tag("pl")
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier(AXID.onboardingLanguage)
        }
    }

    private var countrySection: some View {
        Section(I18n.t(language, "settings.country")) {
            Picker(I18n.t(language, "settings.country"), selection: Binding(
                get: { model.country },
                set: { code in Task { await model.changeCountry(code) } }
            )) {
                ForEach(CountryCatalog.all(language: language)) { c in
                    Text(c.name).tag(c.code)
                }
            }
            Button {
                Task { await model.useLocation() }
            } label: {
                Label(model.locating ? "…" : "Use my location", systemImage: "location")
            }
            .disabled(model.locating)
        }
    }

    private var servicesSection: some View {
        Section(I18n.t(language, "settings.services")) {
            if model.loadingProviders {
                ProgressView()
            } else {
                ForEach(model.providers) { svc in
                    Button {
                        model.toggle(svc.id)
                    } label: {
                        HStack {
                            ServiceLogo(service: svc)
                            Text(svc.name).foregroundStyle(.primary)
                            Spacer()
                            if model.selectedServices.contains(svc.id) {
                                Image(systemName: "checkmark").foregroundStyle(.tint)
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var accountSection: some View {
        Section(I18n.t(language, "settings.account")) {
            if model.signedIn {
                Label(app.me?.user?.email ?? app.me?.user?.name ?? "", systemImage: "checkmark.seal.fill")
                    .foregroundStyle(.secondary)
            } else {
                if app.me?.providers.contains("google") ?? false {
                    Button(I18n.t(language, "settings.signInGoogle")) { Task { await model.signIn(provider: "google") } }
                        .accessibilityIdentifier(AXID.onboardingSignIn)
                }
                if app.me?.providers.contains("facebook") ?? false {
                    Button(I18n.t(language, "settings.signInFacebook")) { Task { await model.signIn(provider: "facebook") } }
                }
            }
        }
    }
}
