import Foundation

/// Tolerant JSON handling for the server contract.
///
/// The Android client parses with kotlinx.serialization's `ignoreUnknownKeys`
/// and per-field defaults, so a missing or null field degrades that one field
/// rather than failing the whole payload. Swift's synthesized `Codable` is the
/// opposite — strict — which is exactly the footgun that "empties a whole list
/// on one field mismatch". Our model `init(from:)` decoders use
/// ``Swift/KeyedDecodingContainer/decode(_:forKey:default:)`` to match the
/// server's looseness. (Unknown keys are ignored by `Codable` already.)
public enum FilmowoJSON {
    public static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        return d
    }()

    public static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        return e
    }()

    public static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        try decoder.decode(type, from: data)
    }

    /// Decode a newline-delimited JSON stream (the shape of `/api/enrich`),
    /// tolerating blank lines and skipping any line that fails to parse.
    public static func decodeNDJSON<T: Decodable>(_ type: T.Type, from data: Data) -> [T] {
        guard let text = String(data: data, encoding: .utf8) else { return [] }
        var rows: [T] = []
        for line in text.split(whereSeparator: \.isNewline) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty, let lineData = trimmed.data(using: .utf8) else { continue }
            if let row = try? decoder.decode(type, from: lineData) { rows.append(row) }
        }
        return rows
    }
}

public extension KeyedDecodingContainer {
    /// Decode `key` if present and non-null, otherwise return `def`. Mirrors a
    /// kotlinx.serialization field with a default value.
    func decode<T: Decodable>(_ type: T.Type, forKey key: Key, default def: T) throws -> T {
        try decodeIfPresent(type, forKey: key) ?? def
    }
}
