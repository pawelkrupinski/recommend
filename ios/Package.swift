// swift-tools-version: 5.9
import PackageDescription

// A Foundation-only view of the app's shared logic (models, decoding, i18n,
// region resolution, endpoint building), so the contract layer is testable with
// `swift test` on Linux — no Xcode, no simulator. The same FilmowoCore/ sources
// are compiled into the app target by the Xcode project (see project.yml). The
// SwiftUI / CoreLocation / networking layers live in Filmowo/ and are NOT part
// of this package. Mirrors the movies app's dual Xcode + SPM structure.
let package = Package(
    name: "Filmowo",
    platforms: [.macOS(.v13), .iOS(.v16)],
    products: [
        .library(name: "FilmowoCore", targets: ["FilmowoCore"]),
    ],
    targets: [
        .target(
            name: "FilmowoCore",
            path: "FilmowoCore"
        ),
        .testTarget(
            name: "FilmowoCoreTests",
            dependencies: ["FilmowoCore"],
            path: "FilmowoCoreTests",
            resources: [.copy("Fixtures")]
        ),
    ]
)
