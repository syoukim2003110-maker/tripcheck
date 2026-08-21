import Foundation

public struct GeoPoint: Hashable, Codable, Sendable {
  public var latitude: Double
  public var longitude: Double

  public init(latitude: Double, longitude: Double) {
    self.latitude = latitude
    self.longitude = longitude
  }
}

/// lib/route-optimizer.ts:318-333 — `straightLineDistanceKm` と同じ式(地球半径 6371km の Haversine)
public func straightLineDistanceKm(_ a: GeoPoint, _ b: GeoPoint) -> Double {
  let toRad = Double.pi / 180
  let dLat = (b.latitude - a.latitude) * toRad
  let dLng = (b.longitude - a.longitude) * toRad
  let h = sin(dLat / 2) * sin(dLat / 2) + cos(a.latitude * toRad) * cos(b.latitude * toRad) * sin(dLng / 2) * sin(dLng / 2)
  return 2 * 6371 * atan2(sqrt(h), sqrt(1 - h))
}
