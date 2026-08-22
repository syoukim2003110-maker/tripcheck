import Foundation

public struct GeoPoint: Hashable, Codable, Sendable {
  public var latitude: Double
  public var longitude: Double

  public init(latitude: Double, longitude: Double) {
    self.latitude = latitude
    self.longitude = longitude
  }
}

/// lib/route-optimizer.ts:318-328 — `straightLineDistanceKm` (a 6371 km Haversine).
///
/// Both the shape of the expression and the arithmetic behind it are TypeScript's. `asin(√h)` is
/// not written as `atan2(√h, √(1−h))`, `度 × π ÷ 180` is not folded into `度 × (π ÷ 180)`, and the
/// two cosines multiply the *squared* half-angle sine rather than the sine twice, because `**`
/// binds tighter than `*`. Each of those rewrites is exact in real arithmetic and moves the last
/// bit in floating point.
///
/// The trigonometry comes from `JSMath`, a port of V8's own `ieee754.cc`, not from Foundation:
/// Apple's libm is the more accurate of the two and therefore the wrong one here. The route
/// optimiser compares a path against its own reverse — the same edges in the other order — so a
/// one-ulp difference in a single edge decides the direction of a whole day. See the `JSMath`
/// header for the measured divergence rates.
public func straightLineDistanceKm(_ a: GeoPoint, _ b: GeoPoint) -> Double {
  func radians(_ degrees: Double) -> Double { degrees * Double.pi / 180 }
  let earthRadiusKm = 6371.0
  let deltaLatitude = radians(b.latitude - a.latitude)
  let deltaLongitude = radians(b.longitude - a.longitude)
  let latitudeA = radians(a.latitude)
  let latitudeB = radians(b.latitude)
  let halfLatitudeSineSquared = JSMath.sin(deltaLatitude / 2) * JSMath.sin(deltaLatitude / 2)
  let halfLongitudeSineSquared = JSMath.sin(deltaLongitude / 2) * JSMath.sin(deltaLongitude / 2)
  let h = halfLatitudeSineSquared + JSMath.cos(latitudeA) * JSMath.cos(latitudeB) * halfLongitudeSineSquared
  // `h > 1` yields NaN, exactly as `Math.asin` does in the browser. Clamping would be a kindness
  // the TypeScript engine does not extend, and parity is the whole point.
  return 2 * earthRadiusKm * JSMath.asin(h.squareRoot())
}
