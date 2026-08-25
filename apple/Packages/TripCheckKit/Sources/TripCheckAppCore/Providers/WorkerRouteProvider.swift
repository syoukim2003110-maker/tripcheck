import Foundation
import TripCheckKit

/// 経路の Google 優先リゾルバ。`RouteFetcher` は 1 レグ×モードごとに `route()` を呼ぶので、
/// 1 レグ payload を `/api/live-routes` へ送る。Google が綺麗に答えれば Google、答えられなければ
/// 端末内 Apple（`fallback`）。両者を並行に走らせるので、フォールバックは待ち時間を増やさない
/// （Google が勝てば未 await の Apple は scope 退出で cancel される）。
public struct WorkerRouteProvider: RouteProvider {
  private let client: any WorkerAuthenticating
  private let fallback: any RouteProvider
  private let timeout: Duration
  private let now: @Sendable () -> Date

  public init(
    client: any WorkerAuthenticating,
    fallback: any RouteProvider,
    timeout: Duration = .seconds(10),
    now: @escaping @Sendable () -> Date = Date.init
  ) {
    self.client = client
    self.fallback = fallback
    self.timeout = timeout
    self.now = now
  }

  public func route(_ request: RouteRequest, locale: PlannerLocale) async -> RouteOutcome {
    async let google = askGoogle(request, locale)
    async let apple = fallback.route(request, locale: locale)
    if let g = await google { return g }
    return await apple
  }

  /// Google の綺麗な `.measured` のみ non-nil。未認証/タイムアウト/非成功/minutes<1 は nil。
  private func askGoogle(_ request: RouteRequest, _ locale: PlannerLocale) async -> RouteOutcome? {
    let payload = LiveRoutesRequestPayload(
      legs: [LiveRouteLegPayload(
        id: request.legKey,
        origin: request.from,
        destination: request.to,
        departureTime: Self.iso8601(request.departure ?? now())
      )],
      languageCode: locale.rawValue,
      travelMode: Self.travelMode(request.mode)
    )
    guard let result = await withinTimeout(payload),
          let leg = result.legs.first,
          leg.status == "ok",
          let minutes = leg.durationMinutes, minutes >= 1
    else { return nil }
    return .measured(
      minutes: minutes,
      distanceMeters: leg.distanceMeters,
      geometry: leg.encodedPolyline.map { PolylineSimplifier.thinned(GooglePolyline.decode($0)) },
      expectedDeparture: request.departure
    )
  }

  private func withinTimeout(_ payload: LiveRoutesRequestPayload) async -> LiveRoutesResult? {
    let client = self.client
    let limit = timeout
    return await withTaskGroup(of: LiveRoutesResult?.self) { group in
      group.addTask { await client.liveRoutes(payload) }
      group.addTask {
        try? await Task.sleep(for: limit)
        return nil
      }
      let first = await group.next() ?? nil
      group.cancelAll()
      return first
    }
  }

  private static func travelMode(_ mode: TransportMode) -> String {
    switch mode {
    case .walk: return "WALK"
    case .taxi: return "DRIVE"
    case .transit: return "TRANSIT"
    }
  }

  private static func iso8601(_ date: Date) -> String {
    ISO8601DateFormatter().string(from: date)
  }
}
