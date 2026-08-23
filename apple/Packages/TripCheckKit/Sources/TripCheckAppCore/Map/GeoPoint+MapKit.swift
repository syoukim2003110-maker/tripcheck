import MapKit
import TripCheckKit

/*
 * Kit の値を `MapKit` の形に直す唯一の場所。
 *
 * Kit の `GeoPoint` は緯度と経度だけの値型で、`CoreLocation` を import しない ——
 * `Sources/TripCheckKit` に `import UIKit|SwiftUI|MapKit` が無いことは
 * `Invariants/ImportBoundaryTests.swift` が走査で守っている境界そのもので、エンジンが
 * Apple の地図に依存し始めた瞬間に、同じ計算を別の場所で動かす道(パリティ検証)が閉じる。
 *
 * AppCore は逆に import してよい(`Providers/ApplePlaceResolver.swift` が既に `MKLocalSearch`
 * を使っている)。だから変換はこの 2 つの計算プロパティに閉じ、ビューにも導出値にも
 * `CLLocationCoordinate2D` を持ち歩かせない。
 */

extension GeoPoint {
  /// 地図に置ける座標。
  public var clLocation: CLLocationCoordinate2D {
    CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
  }
}

extension MapRegion {
  /// カメラに渡せる矩形(`MapCameraPosition.region(_:)`)。
  public var mkRegion: MKCoordinateRegion {
    MKCoordinateRegion(
      center: center.clLocation,
      span: MKCoordinateSpan(latitudeDelta: latitudeDelta, longitudeDelta: longitudeDelta)
    )
  }
}
