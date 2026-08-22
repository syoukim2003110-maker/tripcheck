import Foundation

/// lib/route-optimizer.ts:436 — `travelMode: "transit" | "walking" | "driving"`
public enum GoogleTravelMode: String, Codable, Sendable {
  case transit, walking, driving
}

/// lib/route-optimizer.ts:436-452 — `buildGoogleMapsUrl`
public enum GoogleMapsUrl {
  public static func build(_ stops: [RouteStop], travelMode: GoogleTravelMode = .transit) -> String {
    // Google Maps URLs accept at most `googleMapsWaypointLimit` points; drop middle
    // waypoints but keep the real destination so the final leg never vanishes.
    let visibleStops: [RouteStop]
    if stops.count > EngineConstants.googleMapsWaypointLimit {
      visibleStops = Array(stops.prefix(EngineConstants.googleMapsWaypointLimit - 1)) + [stops[stops.count - 1]]
    } else {
      visibleStops = stops
    }

    func coordinate(_ stop: RouteStop) -> String {
      "\(jsNumberString(stop.latitude)),\(jsNumberString(stop.longitude))"
    }

    var pairs: [(String, String)] = [
      ("api", "1"),
      ("origin", coordinate(visibleStops[0])),
      ("destination", coordinate(visibleStops[visibleStops.count - 1])),
      ("travelmode", travelMode.rawValue),
    ]
    if visibleStops.count > 2 {
      let waypoints = visibleStops[1..<(visibleStops.count - 1)].map(coordinate).joined(separator: "|")
      pairs.append(("waypoints", waypoints))
    }

    let query = pairs.map { "\(formUrlEncode($0.0))=\(formUrlEncode($0.1))" }.joined(separator: "&")
    return "https://www.google.com/maps/dir/?\(query)"
  }
}

/// JS の `Number.prototype.toString()`(テンプレートリテラル内挿)に合わせる: 整数値は
/// 小数点なしで出す(緯度経度は通常小数だが、念のため 0 度などの境界値でも一致させる)。
private func jsNumberString(_ value: Double) -> String {
  if value.truncatingRemainder(dividingBy: 1) == 0, abs(value) < 1e15 {
    return String(Int64(value))
  }
  return String(value)
}

/// `URLSearchParams#toString()` と同じ `application/x-www-form-urlencoded` エンコード
/// (未予約文字は `A-Za-z0-9-._*`、空白は `+`、それ以外は大文字 2 桁の `%XX`)。
/// `,` や `|` はここで `%2C`/`%7C` になる — `URLComponents` の RFC3986 クエリエンコードとは
/// 予約文字集合が異なるため使わない。
private func formUrlEncode(_ value: String) -> String {
  var result = ""
  for byte in value.utf8 {
    switch byte {
    case 0x41...0x5A, 0x61...0x7A, 0x30...0x39, 0x2D, 0x2E, 0x5F, 0x2A:
      result.unicodeScalars.append(Unicode.Scalar(byte))
    case 0x20:
      result.append("+")
    default:
      result += String(format: "%%%02X", byte)
    }
  }
  return result
}
