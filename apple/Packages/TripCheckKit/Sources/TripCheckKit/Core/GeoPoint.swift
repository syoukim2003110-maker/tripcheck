import Foundation

public struct GeoPoint: Hashable, Codable, Sendable {
  public var latitude: Double
  public var longitude: Double

  public init(latitude: Double, longitude: Double) {
    self.latitude = latitude
    self.longitude = longitude
  }
}

/// lib/route-optimizer.ts:318-328 — `straightLineDistanceKm`(地球半径 6371km の Haversine)。
///
/// 式の**書き方**まで TS に合わせてある。`asin(√h)` と `atan2(√h, √(1−h))` は実数では同じ値だが
/// 浮動小数では最後の 1 ulp が食い違い、`optimizeFromBase` / `optimizeKnownStopOrder` の厳密な
/// `<` 比較が引き分けの向きを逆に倒すことがある(2 点の日が TS と逆順に出る)。同じ理由で
/// `度 × π ÷ 180` を `度 × (π ÷ 180)` に畳んではいけない。`x ** 2` は V8 が `x * x` へ特殊化する
/// (fdlibm `__ieee754_pow` の y == 2 分岐)ので、そこだけは掛け算で書いてよい。
public func straightLineDistanceKm(_ a: GeoPoint, _ b: GeoPoint) -> Double {
  func radians(_ degrees: Double) -> Double { degrees * Double.pi / 180 }
  let earthRadiusKm = 6371.0
  let deltaLatitude = radians(b.latitude - a.latitude)
  let deltaLongitude = radians(b.longitude - a.longitude)
  let latitudeA = radians(a.latitude)
  let latitudeB = radians(b.latitude)
  // `**` binds tighter than `*`, so TS multiplies the two cosines by the *squared* sine — not by
  // the sine twice. The two groupings do not round the same way.
  let halfLatitudeSineSquared = sin(deltaLatitude / 2) * sin(deltaLatitude / 2)
  let halfLongitudeSineSquared = sin(deltaLongitude / 2) * sin(deltaLongitude / 2)
  let h = halfLatitudeSineSquared + cos(latitudeA) * cos(latitudeB) * halfLongitudeSineSquared
  return 2 * earthRadiusKm * asin(sqrt(h))
}
