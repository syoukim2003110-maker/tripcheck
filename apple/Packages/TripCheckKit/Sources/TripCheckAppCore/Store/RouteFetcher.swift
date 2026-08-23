import Foundation
import TripCheckKit

/// 同時 `concurrency` 件の窓で取得し、`deadline` で打ち切る(spec §4.4)。答えの無い要求は辞書に
/// **入らない**(失敗と同じ扱い、印は呼び手が付ける)。`ApplePlaceResolver.resolve` と同じ窓:
/// 1 件返るたびに次を 1 件立てる。
///
/// **ここでは再試行しない。** スロットルの 1/2/4 秒と 1 件ごとの制限時間(徒歩・車 8 秒 /
/// 公共交通 12 秒)は `AppleRouteProvider` の中にあり、この窓から見た `.failed` は
/// 「もう待った後の答え」である。だから締切は**待って諦める**のではなく、走っている
/// 問い合わせを取り消して閉じる —— 公共交通 1 件は再試行を挟むと 55 秒近く占有でき、
/// 40 秒の締切を素直に待っていると窓がその 1 件に食われる。提供元のレースは取り消しで
/// すぐ解ける(`AppleRouteProvider.race` の `group.cancelAll()`)。
enum RouteFetcher {
  static let concurrency = 4
  static let deadline: Duration = .seconds(40)

  static func fetch(
    _ requests: [RouteRequest],
    provider: any RouteProvider,
    locale: PlannerLocale,
    concurrency: Int = concurrency,
    deadline: Duration = deadline,
    onSettled: @escaping @MainActor @Sendable (RouteRequest, RouteOutcome) -> Void
  ) async -> [RouteRequest: RouteOutcome] {
    guard !requests.isEmpty else { return [:] }
    return await withTaskGroup(of: (RouteRequest, RouteOutcome)?.self) { group in
      var answers: [RouteRequest: RouteOutcome] = [:]
      var pending = requests.makeIterator()
      var inFlight = 0
      group.addTask { try? await Task.sleep(for: deadline); return nil }   // 締切の時計
      for _ in 0..<max(1, concurrency) {
        guard let request = pending.next() else { break }
        inFlight += 1
        group.addTask { (request, await provider.route(request, locale: locale)) }
      }
      while inFlight > 0, let next = await group.next() {
        guard let settled = next else { break }   // 締切が鳴った
        inFlight -= 1
        answers[settled.0] = settled.1
        await onSettled(settled.0, settled.1)
        if let request = pending.next() {
          inFlight += 1
          group.addTask { (request, await provider.route(request, locale: locale)) }
        }
      }
      group.cancelAll()   // 負けた側(時計か、締切後の取得)を畳む。提供元は取り消しで解ける
      return answers
    }
  }
}
