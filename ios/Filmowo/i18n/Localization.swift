import SwiftUI
import FilmowoCore

/// The active UI language, injected at the app root from `AppModel.language`
/// (the user's server-chosen language), mirroring Android's `LocalLanguage`
/// composition local. Views read `@Environment(\.language)` and translate with
/// ``FilmowoCore/I18n``.
private struct LanguageKey: EnvironmentKey { static let defaultValue = "en" }

extension EnvironmentValues {
    var language: String {
        get { self[LanguageKey.self] }
        set { self[LanguageKey.self] = newValue }
    }
}

extension View {
    /// Bind the whole subtree's translation language.
    func language(_ lang: String) -> some View { environment(\.language, lang) }
}
