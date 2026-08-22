// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "TripCheckKit",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "TripCheckKit", targets: ["TripCheckKit"]),
    .library(name: "TripCheckAppCore", targets: ["TripCheckAppCore"]),
  ],
  targets: [
    .target(name: "TripCheckKit", swiftSettings: [.swiftLanguageMode(.v6)]),
    .testTarget(
      name: "TripCheckKitTests",
      dependencies: ["TripCheckKit"],
      resources: [.copy("Fixtures")],
      swiftSettings: [.swiftLanguageMode(.v6)]
    ),
    // 画面の手前側(状態・文言・場所解決)。Kit と違って MapKit や Observation を import して
    // よいので `Sources/TripCheckAppCore` に分けてある —— `Invariants/ImportBoundaryTests.swift`
    // が読むのは `Sources/TripCheckKit` だけ。中身は Task 2 以降。
    .target(name: "TripCheckAppCore", dependencies: ["TripCheckKit"], swiftSettings: [.swiftLanguageMode(.v6)]),
    .testTarget(name: "TripCheckAppCoreTests", dependencies: ["TripCheckAppCore"], swiftSettings: [.swiftLanguageMode(.v6)]),
  ]
)
