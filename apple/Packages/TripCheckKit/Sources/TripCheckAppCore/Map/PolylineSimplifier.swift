import Foundation
import TripCheckKit

/// Douglas–Peucker。2000 点を超える経路線だけに約 5 m で掛ける(`MKDirectionsAdapter.geometry`)。
///
/// 端末の地図が返す 1 本の線は、長い車の経路だと数千点になる —— そのまま `PlannerContext` に
/// 持たせると、描くたびに同じ形を何千点で組み直すことになる。落とすのは「線の形を約 5 m 以上
/// 変えない点」だけで、両端は必ず残る(始点と終点は停留所そのもので、動かすと脚が別の場所へ
/// 繋がって見える)。
public enum PolylineSimplifier {
  /// これ以下の点数には掛けない —— 短い線を間引いても描画は速くならず、形だけが変わる。
  public static let simplifyAbovePoints = 2000

  public static func simplify(_ points: [GeoPoint], toleranceMeters: Double) -> [GeoPoint] {
    guard points.count > 2 else { return points }
    var keep = [Bool](repeating: false, count: points.count)
    keep[0] = true
    keep[points.count - 1] = true
    // 再帰ではなく積み。数千点の線で深さが効いてくるのは形ではなくスタックのほう。
    var stack: [(Int, Int)] = [(0, points.count - 1)]
    while let (first, last) = stack.popLast() {
      var farthest = 0.0, index = first
      for i in (first + 1)..<last {
        let d = distanceMeters(points[i], fromSegment: points[first], points[last])
        if d > farthest {
          farthest = d
          index = i
        }
      }
      if farthest > toleranceMeters {
        keep[index] = true
        stack.append((first, index))
        stack.append((index, last))
      }
    }
    return points.enumerated().filter { keep[$0.offset] }.map(\.element)
  }

  /// 等距円筒近似(経路線 1 本の範囲では十分)。緯度は線分の始点のものを使う ——
  /// 1 本の脚の中で cos が動く幅は、5 m の物差しには効かない。
  static func distanceMeters(_ p: GeoPoint, fromSegment a: GeoPoint, _ b: GeoPoint) -> Double {
    let scale = 111_320.0, cosLat = cos(a.latitude * .pi / 180)
    let bx = (b.longitude - a.longitude) * scale * cosLat, by = (b.latitude - a.latitude) * scale
    let px = (p.longitude - a.longitude) * scale * cosLat, py = (p.latitude - a.latitude) * scale
    let len2 = bx * bx + by * by
    let t = len2 == 0 ? 0 : max(0, min(1, (px * bx + py * by) / len2))
    let dx = px - t * bx, dy = py - t * by
    return (dx * dx + dy * dy).squareRoot()
  }
}
