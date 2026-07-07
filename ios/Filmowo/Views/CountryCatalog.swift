import Foundation

/// The list of selectable countries for onboarding / settings, built from the
/// system's ISO regions with names localized to the app language — so we don't
/// maintain a hardcoded list and it matches the user's language.
enum CountryCatalog {
    struct Country: Identifiable, Hashable {
        let code: String   // ISO alpha-2, uppercase
        let name: String
        var id: String { code }
    }

    static func all(language: String) -> [Country] {
        let locale = Locale(identifier: language)
        let countries = Locale.Region.isoRegions
            .map(\.identifier)
            .filter { $0.count == 2 && $0.allSatisfy(\.isLetter) }
            .compactMap { code -> Country? in
                guard let name = locale.localizedString(forRegionCode: code) else { return nil }
                return Country(code: code.uppercased(), name: name)
            }
        return countries.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
    }

    static func name(for code: String, language: String) -> String {
        Locale(identifier: language).localizedString(forRegionCode: code) ?? code
    }
}
