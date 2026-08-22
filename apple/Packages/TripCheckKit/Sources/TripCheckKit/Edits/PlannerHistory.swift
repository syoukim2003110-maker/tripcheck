import Foundation

/*
 * 利用者が書いた編集のための決定的な台帳。`lib/planner-history.ts`(151 行)の移植。
 *
 * プロバイダの応答・要求中の状態・`AbortController`・その他の非同期の物証はここに入れない。
 * それらは独自の寿命を持ち、再生すると Undo が通信のタイミングに依存する(TS `:1-9`)。
 *
 * TS はその制約を実行時に守らせるために `cloneSerializableValue`(`:33-84`)で「JSON になる値」
 * 以外を投げ、`plannerHistoryStateEqual`(`:87-101`)で構造的に比べる。Swift では値型と
 * `State: Equatable & Sendable` が同じ約束を**型で**果たす:関数・クラス実体・`Date`・循環参照・
 * 疎な配列はそもそも `State` に入れられず、複製は代入そのもの、比較は欄ごとの `==`。よって
 * clone / 直列化ガードは移植せず、`Equatable` に委ねる(TS の「キーの並びが違っても同値」は
 * 構造体には存在しない問題)。
 */
public struct PlannerHistory<State: Equatable> {

  /// TS `MAX_PLANNER_HISTORY`(`lib/planner-history.ts:11`)—— 台帳の天井。製品側がもっと小さい
  /// 上限(`PlannerEdits.undoLimit` = 10)を選ぶのは自由だが、これを超える台帳は作れない。
  public static var maxEntries: Int { 20 }

  public private(set) var past: [State]
  public private(set) var present: State
  public private(set) var future: [State]
  public let limit: Int

  /// TS `createPlannerHistory`(`:103-110`)。既定の上限は TS と同じく天井そのもの
  /// (ブリーフの Interfaces は `limit: Int = 10` と書くが、TS の既定は `MAX_PLANNER_HISTORY`
  /// で、`tests/planner-history.test.ts:91-103`「既定で 20 操作を保つ」がそれに依っている。TS を採る)。
  ///
  /// TS `normalizedLimit`(`:25-31`)は範囲外で `RangeError` を投げる。Swift は表現できない
  /// 台帳を作らせない `precondition` にする —— 上限はどの呼び出し側でも定数で、実行時の入力ではない。
  public init(initial: State, limit: Int = PlannerHistory.maxEntries) {
    precondition(
      limit >= 1 && limit <= Self.maxEntries,
      "Planner history limit must be an integer from 1 to \(Self.maxEntries)."
    )
    self.past = []
    self.present = initial
    self.future = []
    self.limit = limit
  }

  /// TS `canUndoPlannerHistory` / `canRedoPlannerHistory`(`:145-151`)。
  public var canUndo: Bool { !past.isEmpty }
  public var canRedo: Bool { !future.isEmpty }

  /// TS `commitPlannerHistory`(`:116-121`)。1 回の完全な利用者操作を記録する。同値の状態は
  /// 本当の無操作(そのまま自分を返す)で、分岐した編集は Redo を捨てる。
  public func commit(_ nextState: State) -> Self {
    if present == nextState { return self }
    var next = self
    next.past = Array((past + [present]).suffix(limit))
    next.present = nextState
    next.future = []
    return next
  }

  /// TS `undoPlannerHistory`(`:123-132`)。端では何もしない。
  public func undo() -> Self {
    guard let previous = past.last else { return self }
    var next = self
    next.past = Array(past.dropLast())
    next.present = previous
    next.future = [present] + future
    return next
  }

  /// TS `redoPlannerHistory`(`:134-143`)。
  public func redo() -> Self {
    guard let upcoming = future.first else { return self }
    var next = self
    next.past = Array((past + [present]).suffix(limit))
    next.present = upcoming
    next.future = Array(future.dropFirst())
    return next
  }
}

extension PlannerHistory: Equatable {}
extension PlannerHistory: Sendable where State: Sendable {}

extension PlannerHistory where State == PlannerEditState {

  /// TS `attachPlannerBaseToHistory`(`lib/planner-app-state.ts:517-527`)。
  ///
  /// ビルド後の仮拠点の割り当て(と、その他のシステム主導の拠点引き渡し)は計画の出発点を
  /// 定めるものであって、利用者の操作ではない。過去・現在・未来の全部に拠点を書き直すことで、
  /// 割り当ては履歴の外に出る:エントリは増えず、Undo が割り当て前の経路用拠点へ「戻す」ことも
  /// なく、ずれ検査が割り当てを外部からの損傷と取り違えて履歴を捨てることもない。
  public func attachingBase(_ base: ResolvedStop?) -> Self {
    var next = self
    next.past = past.map { state in
      var copy = state
      copy.resolvedBase = base
      return copy
    }
    next.present = {
      var copy = present
      copy.resolvedBase = base
      return copy
    }()
    next.future = future.map { state in
      var copy = state
      copy.resolvedBase = base
      return copy
    }
    return next
  }
}
