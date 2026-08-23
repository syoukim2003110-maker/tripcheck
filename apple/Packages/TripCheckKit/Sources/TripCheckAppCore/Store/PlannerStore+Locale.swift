import Foundation
import TripCheckKit

/*
 * 言語。
 *
 * 切り替えは**表示だけ**の話である —— 組み上がった旅程(`bundle`)には触らない。見出しも
 * タイムラインの行も地図の凡例も `request.locale` から毎回導出しているので、欄を 1 つ書き
 * 換えれば画面ぜんぶが新しい言葉で言い直される。組み直すと、同じ旅を待たされたうえに、
 * 座標も分も変わっていないことを旅行者が確かめる手立てが無くなる。
 */
extension PlannerStore {

  /// 選んだ言語を置く鍵。旅ではなく人に属するので `UserDefaults`(旅程の記録には入らない)。
  public static let localeKey = "tripcheck-locale"

  /// 端末に残っている選択。読めない値は無かったことにする —— 保存が壊れていても起動する。
  public static func storedLocale(in defaults: UserDefaults) -> PlannerLocale? {
    defaults.string(forKey: localeKey).flatMap(PlannerLocale.init(rawValue:))
  }

  /// 一度も選んでいない旅行者の既定。`Locale.current.language.languageCode` は
  /// `Locale.LanguageCode?` で、文字列ではない。
  public static var systemLocale: PlannerLocale {
    Locale.current.language.languageCode?.identifier == "ja" ? .ja : .en
  }

  /// 言語を切り替える。
  ///
  /// 走っている組み立ての答えは捨てる —— その束は**切り替える前の言葉**で組まれていて
  /// (`WishlistSerialization.raw` も `TripRequest.locale` も古いほうを見ている)、遅れて
  /// 着けば新しい画面に古い言葉が混ざる。捨てる手として `cancelBuild()` を通すのは、
  /// 世代を進めるだけだと「組み立て中」の画面に取り残されるから:あちらは同じ 1 手で
  /// 待ち画面も畳む。
  public func changeLocale(_ locale: PlannerLocale) {
    guard locale != request.locale else { return }
    cancelBuild()
    request.locale = locale
    defaults.set(locale.rawValue, forKey: PlannerStore.localeKey)
  }
}
