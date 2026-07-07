import Foundation
import XCTest

/// Guards that the iOS app ships the shared red-TV mark as its app icon — the
/// same artwork the web OG cards and the Android launcher use. Foundation-only
/// so it runs in the fast `swift test` lane: it walks from this source file to
/// the asset catalog, checks Contents.json actually points at a bundled image,
/// and parses that PNG's header to enforce the App Store rules (1024×1024, no
/// alpha channel). Regresses if the appiconset is left empty again.
final class AppIconAssetTests: XCTestCase {
    private var appIconSet: URL {
        // #filePath -> .../ios/FilmowoCoreTests/AppIconAssetTests.swift
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()   // FilmowoCoreTests
            .deletingLastPathComponent()   // ios
            .appendingPathComponent("Filmowo/Assets.xcassets/AppIcon.appiconset")
    }

    func testAppIconReferencesABundledImage() throws {
        let contents = appIconSet.appendingPathComponent("Contents.json")
        struct Catalog: Decodable {
            struct Image: Decodable { let size: String; let filename: String? }
            let images: [Image]
        }
        let catalog = try JSONDecoder().decode(Catalog.self, from: Data(contentsOf: contents))
        let icon = catalog.images.first { $0.size == "1024x1024" }
        let filename = try XCTUnwrap(icon?.filename, "AppIcon.appiconset has no 1024×1024 image filename")

        let png = appIconSet.appendingPathComponent(filename)
        XCTAssertTrue(FileManager.default.fileExists(atPath: png.path), "Missing icon image \(filename)")

        let (width, height, hasAlpha) = try pngHeader(png)
        XCTAssertEqual(width, 1024, "App icon must be 1024 wide")
        XCTAssertEqual(height, 1024, "App icon must be 1024 tall")
        XCTAssertFalse(hasAlpha, "App Store app icons must not have an alpha channel")
    }

    /// Reads width/height/colour-type from a PNG's IHDR chunk (no image libs).
    private func pngHeader(_ url: URL) throws -> (width: Int, height: Int, hasAlpha: Bool) {
        let bytes = [UInt8](try Data(contentsOf: url))
        // 8-byte signature, then IHDR: length(4) type(4) width(4) height(4) depth(1) colour(1)
        XCTAssertGreaterThanOrEqual(bytes.count, 26, "Truncated PNG")
        func be32(_ i: Int) -> Int {
            (Int(bytes[i]) << 24) | (Int(bytes[i+1]) << 16) | (Int(bytes[i+2]) << 8) | Int(bytes[i+3])
        }
        let width = be32(16)
        let height = be32(20)
        let colourType = bytes[25]           // 4 = grey+alpha, 6 = truecolour+alpha
        return (width, height, colourType == 4 || colourType == 6)
    }
}
