import Foundation
import TripCheckKit

/// 通信しない決定的な提供元。`-uiTesting` の注入先(`TripCheckApp`)。
///
/// 直線距離だけを見る —— 乱数も時計も端末の地図も見ないので、同じ 2 点には毎回同じ分が返る。
/// 徒歩 12 分/km、車 max(3, 3 分/km)、公共交通 max(5, 4 分/km)。徒歩・車は 3 点のジオメトリ
/// (少しだけ膨らませた中点)で、直線と見分けが付く形を画面に出す。
public struct CannedRouteProvider: RouteProvider {
  public init() {}

  public func route(_ request: RouteRequest, locale: PlannerLocale) async -> RouteOutcome {
    let km = straightLineDistanceKm(request.from, request.to), meters = Int((km * 1000).rounded())
    let mid = GeoPoint(latitude: (request.from.latitude + request.to.latitude) / 2 + 0.002, longitude: (request.from.longitude + request.to.longitude) / 2)
    switch request.mode {
    case .walk: return .measured(minutes: max(1, Int((km * 12).rounded())), distanceMeters: meters, geometry: [request.from, mid, request.to], expectedDeparture: nil)
    case .taxi: return .measured(minutes: max(3, Int((km * 3).rounded())), distanceMeters: meters, geometry: [request.from, mid, request.to], expectedDeparture: request.departure)
    // 公共交通は端末の地図でも経路線が返らない(`calculateETA()` は所要と距離だけで、
    // `MKPolyline` は無い)。距離はアダプタが素通しするが、ここでは伏せる —— 直線距離は
    // 線路の長さではないので、それを距離として出すと画面に嘘の数字が乗る。
    case .transit: return .measured(minutes: max(5, Int((km * 4).rounded())), distanceMeters: nil, geometry: nil, expectedDeparture: request.departure)
    }
  }
}
