import Foundation
import TripCheckKit

/// Google 1e-5 デルタ符号化文字列を [GeoPoint] に復号する。部分入力は受け取らない
/// (緯度経度が揃わない/不正チャンクは空配列)。web `lib/google-polyline.ts` の移植。
public enum GooglePolyline {
  public static func decode(_ value: String) -> [GeoPoint] {
    if value.isEmpty { return [] }
    let scalars = Array(value.unicodeScalars)
    var points: [GeoPoint] = []
    var cursor = 0
    var latitude = 0
    var longitude = 0

    func readDelta() -> Int? {
      var result: Int32 = 0
      var shift: Int32 = 0
      while cursor < scalars.count && shift <= 30 {
        let chunk = Int32(scalars[cursor].value) - 63
        cursor += 1
        if chunk < 0 || chunk > 63 { return nil }
        result |= (chunk & 0x1f) << shift
        if chunk < 0x20 { return Int((result & 1) != 0 ? ~(result >> 1) : (result >> 1)) }
        shift += 5
      }
      return nil
    }

    while cursor < scalars.count {
      guard let dLat = readDelta(), let dLng = readDelta() else { return [] }
      latitude += dLat
      longitude += dLng
      points.append(GeoPoint(latitude: Double(latitude) / 1e5, longitude: Double(longitude) / 1e5))
    }
    return points
  }
}
