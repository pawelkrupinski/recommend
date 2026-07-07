import SwiftUI
import FilmowoCore

/// The Settings tab: account (sign in/out, delete), country, streaming services,
/// and interface language. Mirrors Android's settings screen.
struct SettingsView: View {
    @ObservedObject var store: SettingsStore
    @Environment(\.language) private var language
    @State private var confirmingDelete = false

    var body: some View {
        NavigationStack {
            Form {
                accountSection
                languageSection
                countrySection
                servicesSection
            }
            .navigationTitle(I18n.t(language, "nav.settings"))
            .task { await store.load() }
            .alert(I18n.t(language, "settings.deleteAccount"), isPresented: $confirmingDelete) {
                Button(I18n.t(language, "common.back"), role: .cancel) {}
                Button(I18n.t(language, "settings.deleteAccount"), role: .destructive) {
                    Task { await store.deleteAccount() }
                }
            }
        }
    }

    private var accountSection: some View {
        Section(I18n.t(language, "settings.account")) {
            if store.isSignedIn {
                Label(store.me?.user?.email ?? store.me?.user?.name ?? "", systemImage: "person.crop.circle.fill")
                Button(I18n.t(language, "settings.signOut")) { Task { await store.signOut() } }
                    .accessibilityIdentifier(AXID.settingsSignOut)
                Button(I18n.t(language, "settings.deleteAccount"), role: .destructive) { confirmingDelete = true }
                    .accessibilityIdentifier(AXID.settingsDelete)
            } else {
                Text(I18n.t(language, "settings.anonymous")).foregroundStyle(.secondary)
                if store.availableProviders.contains("google") {
                    Button(I18n.t(language, "settings.signInGoogle")) { Task { await store.signIn(provider: "google") } }
                }
                if store.availableProviders.contains("facebook") {
                    Button(I18n.t(language, "settings.signInFacebook")) { Task { await store.signIn(provider: "facebook") } }
                }
            }
        }
    }

    private var languageSection: some View {
        Section(I18n.t(language, "settings.language")) {
            Picker(I18n.t(language, "settings.language"), selection: Binding(
                get: { store.language },
                set: { lang in Task { await store.changeLanguage(lang) } }
            )) {
                Text("English").tag("en")
                Text("Polski").tag("pl")
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier(AXID.settingsLanguage)
        }
    }

    private var countrySection: some View {
        Section(I18n.t(language, "settings.country")) {
            Picker(I18n.t(language, "settings.country"), selection: Binding(
                get: { store.country },
                set: { code in Task { await store.changeCountry(code) } }
            )) {
                ForEach(CountryCatalog.all(language: language)) { c in
                    Text(c.name).tag(c.code)
                }
            }
            .accessibilityIdentifier(AXID.settingsCountry)
        }
    }

    private var servicesSection: some View {
        Section(I18n.t(language, "settings.services")) {
            if store.loadingProviders {
                ProgressView()
            } else {
                ForEach(store.providers) { svc in
                    Button {
                        store.toggleService(svc.id)
                    } label: {
                        HStack {
                            ServiceLogo(service: svc)
                            Text(svc.name).foregroundStyle(.primary)
                            Spacer()
                            if store.selectedServices.contains(svc.id) {
                                Image(systemName: "checkmark").foregroundStyle(.tint)
                            }
                        }
                    }
                }
            }
        }
    }
}
