// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "TripCheckKit",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [.library(name: "TripCheckKit", targets: ["TripCheckKit"])],
  targets: [
    .target(name: "TripCheckKit", swiftSettings: [.swiftLanguageMode(.v6)]),
    .testTarget(
      name: "TripCheckKitTests",
      dependencies: ["TripCheckKit"],
      resources: [.copy("Fixtures")],
      swiftSettings: [.swiftLanguageMode(.v6)]
    ),
  ]
)
