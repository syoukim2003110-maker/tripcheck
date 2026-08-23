import Foundation
import MapKit
import TripCheckKit

/*
 * 端末内の `MKDirections` を Kit の `RouteProvider` に合わせる(spec §5)。`ApplePlaceResolver` と同じ作り:
 * プロトコルの裏に MapKit を閉じ、`CancelHandle` で取り消しを中継し、時計とレースする。
 * Apple の答えは「見つかった」であって「確かめた」ではない —— 出典は `BuildRunner` が `.apple` と記録し、
 * 状態は `estimated` 止まり。
 */

/// 端末の地図が 1 レグに返した答え。MapKit の型はここまでで、外へは出さない
/// (`MKRoute` も `MKPolyline` も `Sendable` を名乗らない)。
public struct DirectionsAnswer: Hashable, Sendable {
  public var travelSeconds: Double
  public var distanceMeters: Double?
  public var geometry: [GeoPoint]?
  public var expectedDeparture: Date?
  public init(travelSeconds: Double, distanceMeters: Double?, geometry: [GeoPoint]?, expectedDeparture: Date?) {
    self.travelSeconds = travelSeconds
    self.distanceMeters = distanceMeters
    self.geometry = geometry
    self.expectedDeparture = expectedDeparture
  }
}

/// 尋ねた結果の 3 分類。**「経路なし」と「答えが返らなかった」は別物** —— 前者はもう一度
/// 尋ねても同じで、後者は次の組み立てで返りうる。
public enum DirectionsFailure: Error, Equatable {
  /// `MKError.loadingThrottled` —— 提供元が 1/2/4 秒で再試行する。
  case throttled
  /// `MKError.directionsNotFound` / `.placemarkNotFound` —— 経路なし。
  case notFound
  case other
}

/// 「この 1 レグの所要を教えて」に答えられるもの。実物は端末の地図、テストはフェイク。
public protocol Directing: Sendable {
  func directions(_ request: RouteRequest) async throws -> DirectionsAnswer
}

/// 実物。`MKDirections` を 1 レグにつき 1 台使う。
///
/// `@MainActor` なのは `MKDirections` とその応答が `Sendable` を名乗らないから
/// (`MKLocalSearchAdapter` と同じ理由)。`init` だけ `nonisolated` にしてあるのは、
/// `AppleRouteProvider` の既定引数としてどこからでも書けるようにするため。
@MainActor
public final class MKDirectionsAdapter: Directing {
  nonisolated public init() {}

  public func directions(_ request: RouteRequest) async throws -> DirectionsAnswer {
    // 入る前に取り消されていたら、何も立てずに返る。`CancelHandle` の一手は**一度しか引けない**
    // ので、既に取り消された待ちに `relaying` を掛けると `onCancel` がその場で一手を使い切り、
    // その後に走り出す `calculate()` を止める手が残らない(打ち切りの効かない問い合わせになる)。
    try Task.checkCancellation()
    let mk = MKDirections.Request()
    mk.source = Self.mapItem(request.from)
    mk.destination = Self.mapItem(request.to)
    mk.requestsAlternateRoutes = false
    switch request.mode {
    case .walk: mk.transportType = .walking
    case .taxi: mk.transportType = .automobile; mk.departureDate = request.departure
    case .transit: mk.transportType = .transit; mk.departureDate = request.departure
    }
    // 1 台を手元に持ったまま待つ(`MKLocalSearchAdapter` と同じ)。`calculate()` はタスクの取り消しを
    // 見ないので、`CancelHandle` が `cancel()` を引いて待ちを解く。
    let directions = MKDirections(request: mk)
    do {
      if request.mode == .transit {
        // transit は ETA しか返さない(`calculate()` は失敗する)。
        let eta = try await CancelHandle { directions.cancel() }.relaying { try await directions.calculateETA() }
        return DirectionsAnswer(travelSeconds: eta.expectedTravelTime, distanceMeters: eta.distance, geometry: nil, expectedDeparture: eta.expectedDepartureDate)
      }
      let response = try await CancelHandle { directions.cancel() }.relaying { try await directions.calculate() }
      guard let route = response.routes.first else { throw DirectionsFailure.notFound }
      return DirectionsAnswer(travelSeconds: route.expectedTravelTime, distanceMeters: route.distance, geometry: Self.geometry(route.polyline), expectedDeparture: nil)
    } catch let error as MKError {
      throw Self.classify(error)
    }
  }

  static func classify(_ error: MKError) -> DirectionsFailure {
    switch error.code {
    case .loadingThrottled: .throttled
    case .directionsNotFound, .placemarkNotFound: .notFound
    default: .other
    }
  }

  /// 座標 → `MKMapItem` はここ 1 か所(iOS 26 で初期化子が変わる)。
  static func mapItem(_ point: GeoPoint) -> MKMapItem { MKMapItem(placemark: MKPlacemark(coordinate: point.clLocation)) }

  /// `MKPolyline` はアダプタの隔離内で `[GeoPoint]` に変換してから返す(MapKit の型を外に出さない)。
  /// **間引きはここでしない** —— 数千点の走査は本線(MainActor)の外でやる仕事で、
  /// `AppleRouteProvider.route` が答えを受け取ってから `PolylineSimplifier.thinned` を掛ける。
  static func geometry(_ polyline: MKPolyline) -> [GeoPoint] {
    var coordinates = [CLLocationCoordinate2D](repeating: kCLLocationCoordinate2DInvalid, count: polyline.pointCount)
    polyline.getCoordinates(&coordinates, range: NSRange(location: 0, length: polyline.pointCount))
    return coordinates.map { GeoPoint(latitude: $0.latitude, longitude: $0.longitude) }
  }
}

/// Kit へ返す側。**分は 1 分から** —— 0 分の脚は「歩いて 0 分」ではなく「答えになっていない」
/// ので `.failed` に読み替える(`LiveRouteMerge.apply` も `minutes >= 1` しか採らない)。
public struct AppleRouteProvider: RouteProvider {
  let directing: any Directing
  let walkDriveTimeout: Duration
  let transitTimeout: Duration
  let throttleDelays: [Duration]

  public init(
    directing: any Directing = MKDirectionsAdapter(),
    walkDriveTimeout: Duration = .seconds(8),
    transitTimeout: Duration = .seconds(12),
    throttleDelays: [Duration] = [.seconds(1), .seconds(2), .seconds(4)]
  ) {
    self.directing = directing
    self.walkDriveTimeout = walkDriveTimeout
    self.transitTimeout = transitTimeout
    self.throttleDelays = throttleDelays
  }

  public func route(_ request: RouteRequest, locale: PlannerLocale) async -> RouteOutcome {
    // 公共交通のほうが長く待つ。時刻表を引く問い合わせは、道を引く問い合わせより遅い。
    let limit = request.mode == .transit ? transitTimeout : walkDriveTimeout
    let directing = self.directing
    var delays = throttleDelays.makeIterator()
    while true {
      switch await race(limit, { try await directing.directions(request) }) {
      case .answered(let answer):
        let minutes = Int((answer.travelSeconds / 60).rounded())
        guard minutes >= 1 else { return .failed }   // 0 分は failed に読み替える(spec §5)
        // 長い線を間引くのはここ —— アダプタの `@MainActor` の外なので、数千点の走査で画面が待たない。
        return .measured(minutes: minutes, distanceMeters: answer.distanceMeters.map { Int($0.rounded()) }, geometry: answer.geometry.map(PolylineSimplifier.thinned), expectedDeparture: answer.expectedDeparture)
      case .unroutable: return .unroutable
      case .throttled:
        // 3 回まで(1/2/4 秒)。使い切ったら諦める —— 待ち続けるより、次の組み立てで尋ね直す。
        guard let delay = delays.next() else { return .failed }
        try? await Task.sleep(for: delay)
        if Task.isCancelled { return .failed }
      case .failed: return .failed
      }
    }
  }

  private enum Raced: Sendable { case answered(DirectionsAnswer), unroutable, throttled, failed }

  /// 尋ねる側と時計を**本当に競争させる**(`ApplePlaceResolver.race` と同じ形)。
  private func race(_ limit: Duration, _ ask: @escaping @Sendable () async throws -> DirectionsAnswer) async -> Raced {
    await withTaskGroup(of: Raced.self) { group in
      group.addTask {
        do { return .answered(try await ask()) }
        catch DirectionsFailure.notFound { return .unroutable }
        catch DirectionsFailure.throttled { return .throttled }
        catch { return .failed }
      }
      group.addTask { try? await Task.sleep(for: limit); return .failed }
      let first = await group.next() ?? .failed
      group.cancelAll()   // 負けた側を畳む: `Task.sleep` は自分で解け、MapKit は `CancelHandle` が解く
      return first
    }
  }
}
