import Foundation

/// The signed-in identity inside ``Me``.
public struct MeUser: Codable, Hashable {
    public let email: String?
    public let name: String?
    public let picture: String?

    public init(email: String? = nil, name: String? = nil, picture: String? = nil) {
        self.email = email; self.name = name; self.picture = picture
    }
}

/// The `/api/me` boot probe: who the user is, whether they've onboarded, their
/// saved settings, and the country/language the server detected for them.
/// Mirrors Android `Me`. `country`, `detectedCountry`, `detectedLanguage` are
/// nullable because the server sends explicit `null`.
public struct Me: Codable, Hashable {
    public let user: MeUser?
    public let anonymous: Bool
    public let onboarded: Bool
    public let providers: [String]
    public let services: [Int]
    public let country: String?
    public let language: String
    public let detectedCountry: String?
    public let detectedLanguage: String?

    enum CodingKeys: String, CodingKey {
        case user, anonymous, onboarded, providers, services, country, language
        case detectedCountry, detectedLanguage
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        user = try c.decodeIfPresent(MeUser.self, forKey: .user)
        anonymous = try c.decode(Bool.self, forKey: .anonymous, default: true)
        onboarded = try c.decode(Bool.self, forKey: .onboarded, default: false)
        providers = try c.decode([String].self, forKey: .providers, default: [])
        services = try c.decode([Int].self, forKey: .services, default: [])
        country = try c.decodeIfPresent(String.self, forKey: .country)
        language = try c.decode(String.self, forKey: .language, default: "en")
        detectedCountry = try c.decodeIfPresent(String.self, forKey: .detectedCountry)
        detectedLanguage = try c.decodeIfPresent(String.self, forKey: .detectedLanguage)
    }

    public init(
        user: MeUser? = nil, anonymous: Bool = true, onboarded: Bool = false,
        providers: [String] = [], services: [Int] = [], country: String? = nil,
        language: String = "en", detectedCountry: String? = nil, detectedLanguage: String? = nil
    ) {
        self.user = user; self.anonymous = anonymous; self.onboarded = onboarded
        self.providers = providers; self.services = services; self.country = country
        self.language = language; self.detectedCountry = detectedCountry
        self.detectedLanguage = detectedLanguage
    }
}
