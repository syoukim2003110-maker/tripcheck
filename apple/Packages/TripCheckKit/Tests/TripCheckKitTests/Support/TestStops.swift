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

  /// 東京駅の緯度に沿って `ids` の順に西→東へ約 1km 間隔で点を置く。日内順序のテストは
  /// 「どの並びが幾何学的に近いか」を手計算できる必要があるので、円ではなく直線を使う。
  ///
  /// `areas` を渡すと同じ添字の停留所にその地区名が入る(足りない分は空文字のまま)。`theme` は
  /// 訪問順のエリアから作られる(`lib/trip-builder.ts:1664`)ので、その順を手で決められる必要がある。
  static func line(ids: [String], stayMinutes: Int = 90, areas: [String] = []) -> [RouteStop] {
    let latitude = 35.681236 // 東京駅
    // `straightLineDistanceKm` と同じ地球半径 6371km 換算で、この緯度の経度 1 度 ≒ 90.3km。
    let stepDegrees = 1 / (6371 * (Double.pi / 180) * cos(latitude * Double.pi / 180))
    return ids.enumerated().map { index, id in
      point(
        id: id,
        lat: latitude,
        lng: 139.767125 + Double(index) * stepDegrees,
        stayMinutes: stayMinutes,
        area: index < areas.count ? areas[index] : ""
      )
    }
  }

  /// 東京駅周辺 4 点 + 吉祥寺周辺 4 点(約 17km 離れた 2 群)を、群ごとにまとまっていない
  /// 交互順で返す。`Clustering.clusterStops` が入力順ではなく地理で日をまとめること、そして
  /// 種が最西端(= 吉祥寺側)から始まることを確かめるためのフィクスチャ。
  /// 経度は 8 点すべて異なるので「最西端」は一意に決まる。
  static func twoClusters() -> [RouteStop] {
    let tokyo = (latitude: 35.681236, longitude: 139.767125)      // 東京駅
    let kichijoji = (latitude: 35.703043, longitude: 139.579703)  // 吉祥寺駅
    // 群の広がりは半径 500m 程度。群間(約 17km)より 1 桁以上小さいので、どの点も自分の群の
    // 種のほうが近い。
    let offsets: [(latitude: Double, longitude: Double)] = [(0, 0), (0.004, 0.003), (-0.003, 0.005), (0.002, -0.004)]
    return (0..<4).flatMap { index -> [RouteStop] in
      [
        point(
          id: "tokyo-\(index)",
          lat: tokyo.latitude + offsets[index].latitude,
          lng: tokyo.longitude + offsets[index].longitude,
          area: "Tokyo Station"
        ),
        point(
          id: "kichijoji-\(index)",
          lat: kichijoji.latitude + offsets[index].latitude,
          lng: kichijoji.longitude + offsets[index].longitude,
          area: "Kichijoji"
        ),
      ]
    }
  }

  /// 日本の食事窓(昼 11:00-14:30 / 夜 17:30-21:00)。食事停留所のドリフトを見るテスト用。
  static let japanMeals = Destinations.byId(.japan).meals

  /// Task 13/14 の共有ヘルパー。`DayClock.buildDay` を「日本・ホテルなし・空港制約なし・09:00 開始」の
  /// 既定で呼ぶ薄いラッパ。日割り探索は同じ日を何百回も組み直すので、テスト側の呼び出しを 1 行に保つ。
  ///
  /// `deadline` は**門限**(`dayEndTarget`)として渡す。出発便の締切は `index == dayCount - 1` の日に
  /// しか効かない(`lib/trip-builder.ts:1526`)ので、任意の添字の日に締切を置けるのは門限のほうだけ。
  /// Task 14 の食事枠が読むのは `day.deadline` の文字列と `deadlinePreviousDay` だけで
  /// (`lib/trip-builder.ts:481, 488`)、`deadlineKind` は見ないため、この選択は
  /// `dinnerSlotDisappearsWhenDeadlineIsBeforeDinnerStart` を表現するのに十分。
  static func buildPlainDay(_ cluster: [RouteStop], index: Int, deadline: String? = nil) -> BuiltPlanDay {
    DayClock.buildDay(
      stops: cluster,
      index: index,
      dayCount: index + 1,
      locale: .ja,
      startBase: nil,
      endBase: nil,
      airportConstraints: [],
      constraints: [:],
      earlyVisitStopIds: [],
      foodStopIds: [],
      openingWindows: [:],
      destination: Destinations.byId(.japan),
      requestedStart: nil,
      startDate: nil,
      travel: .default,
      dayEndTarget: deadline,
      lockedOrder: []
    )
  }

  static func point(
    id: String,
    lat: Double,
    lng: Double,
    stayMinutes: Int = 90,
    area: String = "",
    isAnchor: Bool = false
  ) -> RouteStop {
    RouteStop(
      id: id,
      name: id,
      area: area,
      latitude: lat,
      longitude: lng,
      sourceUrl: "",
      verifiedAt: "",
      confidence: .medium,
      planningDurationMinutes: stayMinutes,
      isAnchor: isAnchor
    )
  }
}
