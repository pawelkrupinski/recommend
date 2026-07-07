import Foundation

/// `/api/genres` → `{genres}`.
public struct GenresResponse: Codable, Hashable {
    public let genres: [Genre]

    enum CodingKeys: String, CodingKey { case genres }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        genres = try c.decode([Genre].self, forKey: .genres, default: [])
    }
    public init(genres: [Genre] = []) { self.genres = genres }
}

/// `/api/tones` → `{tones}` (mood/tag filter chips).
public struct TonesResponse: Codable, Hashable {
    public let tones: [Tone]

    enum CodingKeys: String, CodingKey { case tones }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tones = try c.decode([Tone].self, forKey: .tones, default: [])
    }
    public init(tones: [Tone] = []) { self.tones = tones }
}

/// `/api/providers?region=XX` → `{providers, source}` (streaming-service picker).
public struct ProvidersResponse: Codable, Hashable {
    public let providers: [Service]
    public let source: String?

    enum CodingKeys: String, CodingKey { case providers, source }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        providers = try c.decode([Service].self, forKey: .providers, default: [])
        source = try c.decodeIfPresent(String.self, forKey: .source)
    }
    public init(providers: [Service] = [], source: String? = nil) {
        self.providers = providers; self.source = source
    }
}

/// A continent bucket in the origin picker: `countries` is a list of
/// `[code, name]` pairs.
public struct Continent: Codable, Hashable, Identifiable {
    public let code: String
    public let name: String
    public let countries: [[String]]
    public var id: String { code }

    public init(code: String, name: String, countries: [[String]] = []) {
        self.code = code; self.name = name; self.countries = countries
    }

    enum CodingKeys: String, CodingKey { case code, name, countries }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        code = try c.decode(String.self, forKey: .code, default: "")
        name = try c.decode(String.self, forKey: .name, default: "")
        countries = try c.decode([[String]].self, forKey: .countries, default: [])
    }
}

/// `/api/origins` → `{continents}` (country-of-origin picker).
public struct OriginsResponse: Codable, Hashable {
    public let continents: [Continent]

    enum CodingKeys: String, CodingKey { case continents }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        continents = try c.decode([Continent].self, forKey: .continents, default: [])
    }
    public init(continents: [Continent] = []) { self.continents = continents }
}

/// `/api/geocode?lat&lng` → `{country}` (reverse-geocode for onboarding).
public struct GeocodeResponse: Codable, Hashable {
    public let country: String?
    public init(country: String? = nil) { self.country = country }
}
