import Foundation
import XCTest
@testable import FilmowoCore

/// Loads a captured JSON/NDJSON fixture bundled with the test target and feeds
/// it through the shared tolerant decoder — the "load fixture and decode"
/// helper, so no test repeats the bundle dance.
enum Fixtures {
    static func data(_ name: String) throws -> Data {
        guard let url = Bundle.module.url(forResource: name, withExtension: nil, subdirectory: "Fixtures")
            ?? Bundle.module.url(forResource: name, withExtension: nil)
        else {
            throw XCTSkip("Missing fixture \(name)")
        }
        return try Data(contentsOf: url)
    }

    static func decode<T: Decodable>(_ type: T.Type, _ name: String) throws -> T {
        try FilmowoJSON.decode(type, from: data(name))
    }
}
