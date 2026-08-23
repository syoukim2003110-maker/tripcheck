import Foundation
import TripCheckKit

/*
 * 地図が描くものの全部 —— 点(ピン)・線(区間)・どこを映すか(範囲)・凡例に並ぶ日。
 *
 * ここも `PlannerStore+ViewModel.swift` と同じ約束の下にある:**ビューは計算しない**。
 * 何番目の訪問か、どの日の色か、耳に何と名乗るか、どこまで寄るかは全部この層が決め、
 * `TripMapView` は受け取った値を `MapKit` の形に直すだけになる。
 *
 * いちばん重い規則は線の側にある。**通った道を知らない区間を、通った道のように描かない**
 * (統合仕様 §9、spec §5.4)。実線は `MapRoute.measured` が真の区間だけ。真にできるのは
 * `PlannerStore.measuredGeometry(for:)` —— 使用中の手段が Apple Maps で測れ、プランがその値を
 * 消費している区間だけで、残りは全部 2 点の破線になる。
 */

/// 地図の点 1 つ。
public struct MapPin: Identifiable, Equatable, Sendable {

  /// 点が何であるか。**種別は 1 つだけ**選ぶ —— 耳に名乗る語(`a11y` の後半)が 1 語である
  /// ためで、「予定地点でもあり注意地点でもある」と読み上げる地図は、どちらを直せばよいのか
  /// を言っていない。
  public enum Kind: Equatable, Sendable {
    /// 旅行者が頼んだ場所。丸の中の数はその日の何番目か(`label` と同じ数)。
    case anchor(number: Int)
    /// TripCheck が挟んだ提案。**今日は作られない**(下の `pinKind(for:)` を見よ)。
    case filler
    /// 食事の場所。**今日は作られない**(食事「枠」はまだ場所を持たない)。
    case meal(MealKind)
    /// その日の拠点(ホテル)。
    case hotel
    /// 旅行者が地図で置いた点(`userProvidedCoordinates`)。提供元が確かめた場所ではない。
    case manual
    /// 旅程がその場所に不都合を見つけた(営業時間の衝突・休業日・予約に遅れる)。
    case warning
  }

  /// 地図の上で一意であればよい id —— 停留所の id か、拠点の id。`ForEach` の鍵と、
  /// 強調の照合先(`view.mapFocusedStopId`)。**詳細シートを開く鍵ではない**(下の `stopId`)。
  public let id: String
  /// **詳細シートを開く鍵**(`Inspector.stop(id)`)。開く中身のある点だけが持つ。
  ///
  /// 種別(`kind`)で判じてはいけない。注意のピンも自分で置いた点も、旅行者が頼んだ
  /// **本物の停留所**である —— とりわけ注意のピンは、詳細シートがまさに直しに行く先で、
  /// そこを閉ざすと「直すところがある」とだけ言って直し方を渡さない地図になる。
  /// `nil` なのは開く中身の無い点だけ:拠点(ホテル)と、場所を持たない食事の枠。
  public let stopId: String?
  public let coordinate: GeoPoint
  public let kind: Kind
  /// 0 始まりの日。色とスコープの絞り込みがこれで決まる。
  public let dayIndex: Int
  /// `DayPalette` の 7 色のどれか。タイムラインの丸と同じ色。
  public let colorHex: String
  /// 丸の中に出る字 —— 訪問の番号。絵で名乗る種別(食事・ホテル・提案)は**空**で、
  /// `PinView` が代わりにアイコンを置く。手動の点は番号を持ったまま、`+` を隅に足す
  /// (v1.1 §5.6「日の識別は常に番号と併用」——「1・2・+・4」の並びは訪問の順を 1 か所
  /// だけ読めなくする)。
  public let label: String
  /// 「ツェルマット、予定地点」。地図の点は絵なので、名前と種別はこの 1 文だけが運ぶ。
  public let a11y: String

  public init(id: String, stopId: String?, coordinate: GeoPoint, kind: Kind, dayIndex: Int, colorHex: String, label: String, a11y: String) {
    self.id = id
    self.stopId = stopId
    self.coordinate = coordinate
    self.kind = kind
    self.dayIndex = dayIndex
    self.colorHex = colorHex
    self.label = label
    self.a11y = a11y
  }
}

/// 停留所と停留所のあいだの線 1 本。
public struct MapRoute: Identifiable, Equatable, Sendable {
  /// `leg:<日>:<その日の何本目>`。同じ 2 地点を 1 日に何度も行き来する旅程でも一意になる
  /// ように、場所の組ではなく**並びの位置**で名乗る(`TimelineRow.id` と同じ理由)。
  public let id: String
  public let dayIndex: Int
  /// 描く点の列。`measured` が偽なら**必ず 2 点**(端から端への直線)。
  public let points: [GeoPoint]
  /// 提供元の経路そのものを描いているか。**提供元が無いビルドでは常に偽。**
  ///
  /// `let` なのは偶然ではない。この 1 つが真になると線は実線になり、地図は「ここを通る」と
  /// 言い切る —— 作った後で誰かがひっくり返せる欄であってはならない。
  public let measured: Bool
  /// 選ばれている日の線か。太さと濃さがこれで変わる(選択日 5pt/.95、他 2pt/.28)。
  public let selected: Bool

  public init(id: String, dayIndex: Int, points: [GeoPoint], measured: Bool, selected: Bool) {
    self.id = id
    self.dayIndex = dayIndex
    self.points = points
    self.measured = measured
    self.selected = selected
  }
}

/// 地図が映す矩形。`MapKit` の `MKCoordinateRegion` に相当するが、AppCore の導出値は
/// **`MapKit` を知らない値型のまま**でいる —— 変換は `Map/GeoPoint+MapKit.swift` の 1 か所。
public struct MapRegion: Equatable, Sendable {
  public var center: GeoPoint
  public var latitudeDelta: Double
  public var longitudeDelta: Double

  public init(center: GeoPoint, latitudeDelta: Double, longitudeDelta: Double) {
    self.center = center
    self.latitudeDelta = latitudeDelta
    self.longitudeDelta = longitudeDelta
  }
}

/// 1 枚の地図。
public struct MapModel: Sendable {
  public var pins: [MapPin]
  public var routes: [MapRoute]
  public var region: MapRegion
  /// 凡例に並ぶ日。**地図に出ている日だけ** —— 押しても何も指さない日ボタンを置かない。
  public var legendDays: [(index: Int, colorHex: String)]

  /// 実線になっている区間の数。「実経路 N区間」(`AppCopy.mapMeasuredRoutesValue`)の材料。
  public var measuredCount: Int { routes.filter(\.measured).count }

  public init(pins: [MapPin], routes: [MapRoute], region: MapRegion, legendDays: [(index: Int, colorHex: String)]) {
    self.pins = pins
    self.routes = routes
    self.region = region
    self.legendDays = legendDays
  }

  /// 点の群れを囲む矩形。`fitBounds` に当たるもの(spec §5.4)。
  ///
  /// 外接そのままではピンが画面の縁に貼り付くので、少しだけ広げてから **1 回だけ**
  /// 最小の広さへクランプする。繰り返しクランプすると、近い 2 点の日で「広げてはクランプ」を
  /// 何度も往復して、日を切り替えるたびに寄りが変わって見える。
  ///
  /// 点が 1 つも無い日は、寄る先が無い。中心 0,0 の最小矩形を返す —— 地図はどこかを映さねば
  /// ならないが、**中身の無い日を勝手にどこかの街へ寄せない**。
  ///
  /// 経度は輪であって数直線ではない。日付変更線をまたぐ日(+179 と −179)の外接を素直に
  /// 取ると幅 358 度 —— 地球をほぼ一周する絵になり、2 キロ離れた 2 か所が地球の裏表に見える。
  /// **東西の差が半周(180 度)を超えたら、それは反対側の弧のほうが短いということ**なので、
  /// 短いほうを採り、中心を線の向こう側へ移して ±180 に丸め直す。
  public static func region(for points: [GeoPoint], minimumSpan: Double = 0.006) -> MapRegion {
    guard let first = points.first else {
      return MapRegion(center: GeoPoint(latitude: 0, longitude: 0), latitudeDelta: minimumSpan, longitudeDelta: minimumSpan)
    }
    var minLatitude = first.latitude, maxLatitude = first.latitude
    var minLongitude = first.longitude, maxLongitude = first.longitude
    for point in points.dropFirst() {
      minLatitude = min(minLatitude, point.latitude)
      maxLatitude = max(maxLatitude, point.latitude)
      minLongitude = min(minLongitude, point.longitude)
      maxLongitude = max(maxLongitude, point.longitude)
    }

    var longitudeSpan = maxLongitude - minLongitude
    var centerLongitude = (minLongitude + maxLongitude) / 2
    if longitudeSpan > 180 {
      longitudeSpan = 360 - longitudeSpan
      centerLongitude = normalisedLongitude(centerLongitude + 180)
    }

    return MapRegion(
      center: GeoPoint(latitude: (minLatitude + maxLatitude) / 2, longitude: centerLongitude),
      latitudeDelta: max(minimumSpan, (maxLatitude - minLatitude) * edgePadding),
      // 余白を足しても地球一周を超えない。`MKCoordinateSpan` に 360 度より広い幅は無い。
      longitudeDelta: min(360, max(minimumSpan, longitudeSpan * edgePadding))
    )
  }

  /// 経度を ±180 の中へ戻す。`-180` と `+180` は同じ子午線なので、どちらに落ちてもよい。
  static func normalisedLongitude(_ longitude: Double) -> Double {
    let wrapped = (longitude + 180).truncatingRemainder(dividingBy: 360)
    return (wrapped < 0 ? wrapped + 360 : wrapped) - 180
  }

  /// 外接をこれだけ広げてから映す。端のピンが縁で切れないぶんの余白。
  private static let edgePadding = 1.3
}
