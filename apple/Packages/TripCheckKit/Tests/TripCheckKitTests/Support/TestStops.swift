import Foundation
@testable import TripCheckKit

/// Task 7 が作る共有テストフィクスチャ。後続タスクは自分の Step 1 で必要なヘルパーを
/// このファイルに追加していく(型リファレンス §「TestStops のヘルパー」参照)。
enum TestStops {
  /// 東京駅付近の小さな円周上に等間隔の `count` 点を置き、円周順(=幾何学的に隣接した順)ではない
  /// 決定的な順序(先頭/末尾を交互に取るジグザグ)で返す。Held-Karp / 2-opt が入力順に依存せず
  /// 最短経路を見つけることを確認するためのフィクスチャ。id は `ring-0`, `ring-1`, … (円周上の
  /// 角度順の番号。配列の並び順とは一致しない)。
  static func ring(count: Int) -> [RouteStop] {
    precondition(count > 0)
    let centerLat = 35.681236 // 東京駅
    let centerLng = 139.767125
    let radiusDegrees = 0.02 // およそ 2km 圏

    let sequential: [RouteStop] = (0..<count).map { index in
      let angle = 2 * Double.pi * Double(index) / Double(count)
      let lat = centerLat + radiusDegrees * sin(angle)
      let lng = centerLng + radiusDegrees * cos(angle)
      return point(id: "ring-\(index)", lat: lat, lng: lng)
    }

    var shuffled: [RouteStop] = []
    shuffled.reserveCapacity(count)
    var low = 0
    var high = count - 1
    var takeLow = true
    while low <= high {
      if takeLow {
        shuffled.append(sequential[low])
        low += 1
      } else {
        shuffled.append(sequential[high])
        high -= 1
      }
      takeLow.toggle()
    }
    return shuffled
  }

  static func point(id: String, lat: Double, lng: Double, stayMinutes: Int = 90) -> RouteStop {
    RouteStop(
      id: id,
      name: id,
      area: "",
      latitude: lat,
      longitude: lng,
      sourceUrl: "",
      verifiedAt: "",
      confidence: .medium,
      planningDurationMinutes: stayMinutes,
      isAnchor: false
    )
  }
}
