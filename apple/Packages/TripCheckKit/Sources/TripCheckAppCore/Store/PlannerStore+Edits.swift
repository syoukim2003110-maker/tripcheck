import Foundation
import TripCheckKit

/*
 * 組み上がった旅程への編集。
 *
 * **ここにあるのは Task 9 が来るまでの最小の 2 本だけ。** ガードも、Undo への積み方も、
 * 取り消せるトーストも、まだ無い —— Task 9 が `PlannerEdits.evaluate(…)` を通した
 * 「聞いてから直す」形に置き換える。それまでのあいだ、タイムラインの手段ピッカーと
 * 滞在時間の指定が**実際に旅程へ届く**ことだけを引き受ける(届かない操作を画面に出すと、
 * 押しても何も起きないボタンを旅行者に押させることになる)。
 */
extension PlannerStore {

  /// 滞在時間を旅行者が決める。`build()` を通すので、変えた後の旅程は必ず組み直したもの
  /// —— 数だけ書き換えて、その先の到着時刻が古いままの画面を作らない。
  ///
  /// Task 9 で置き換わる:必須の場所が落ちる・予約に間に合わなくなる、といった重い結果が
  /// 出る編集は、先に問いかけてから適用する。
  public func setStayMinutes(stopId: String, minutes: Int) async {
    edit.userStayMinutes[stopId] = minutes
    await build()
  }

  /// この区間はこの手段で、という指定。同上、Task 9 でガードが付く。
  public func setLegMode(legKey: String, mode: TransportMode) async {
    edit.legModeOverrides[legKey] = mode
    await build()
  }
}
