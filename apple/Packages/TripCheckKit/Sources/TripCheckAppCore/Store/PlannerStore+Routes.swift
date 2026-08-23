import Foundation
import TripCheckKit

/// 取得の進み具合。`requested` 件のうち `settled` 件が答え(成功・失敗・締切)を持ち、
/// `estimatedRemaining` はどの手段も測れなかった**レグ**の数(要求した鍵のうち `.measured` が 1 つも無いレグ)。
/// 全部測れたら `routeProgress` そのものが `nil` になる。
public struct RouteProgress: Equatable, Sendable {
  public var requested: Int
  public var settled: Int
  public var estimatedRemaining: Int
  public var isComplete: Bool { settled >= requested }
  public init(requested: Int, settled: Int, estimatedRemaining: Int) {
    self.requested = requested
    self.settled = settled
    self.estimatedRemaining = estimatedRemaining
  }
}

extension PlannerStore {
  /// 走っている取得を止め、世代を進める。`keepCache: false` は旅そのものが入れ替わるとき
  /// (`reset()` / 目的地の変更)。`build()` / `cancelBuild()` はキャッシュを残して再利用する。
  func invalidateRoutes(keepCache: Bool) {
    routeTask?.cancel()
    routeTask = nil
    routeGeneration += 1
    attemptedRoutes.removeAll()
    deferredRouteReplacement = nil
    routeProgress = nil
    if !keepCache { liveRoutes.removeAll() }
  }
}
