import Foundation
import TripCheckKit

/*
 * 結果画面が出す「次の一手」の語彙。
 *
 * Kit の `WarningAction` は 3 つしかない(`seeAlternatives` / `seeWhatToRemove` /
 * `reviewConditions`)。それは Web の結論カードが持てる行動の全部で、**場所を確かめる前段**
 * —— 未解決の入力・国の衝突・同名候補 —— は Web では別の画面が受け持っていたからである。
 * 鍵ゼロの iPhone アプリは同じシェルの中でその 3 つも出すので、Kit の 3 つと並べられる
 * 名前をこちら側に置き、写像を 1 か所(`init(kit:stopId:)`)に閉じ込める。
 */

/// 警告 1 件・課題 1 行に添える行動。**Kit の `WarningAction` とは別の型**で、写像は
/// `init(kit:stopId:)` だけが持つ。
public enum PlanWarningAction: Equatable, Sendable {
  /// 入力へ戻る。場所が決まらなかった行を直す道。
  case fixInput
  /// 国を選び直す(場所が 2 か国以上に散っているとき)。
  case chooseCountry
  /// 同名の候補から 1 つ選ぶ。
  case chooseCandidate
  /// 比較できる代替案の一覧へ。
  case openAlternatives
  /// この停留所の詳細を開く。営業時間の確認など、対象が 1 つに決まるとき。
  case openStop(String)
  /// 任意の場所を減らす提案へ。
  case removeOptional
  /// もう一度組み直す。組み立てそのものが答えを出せなかったときの一手で、
  /// 鍵ゼロの経路では起こらない(Task 10 の課題カードが使う)。
  case retryBuild

  /// Kit の行動をアプリの行動へ。`reviewConditions` だけは行き先が 2 つある ——
  /// **どの場所を確かめればよいか分かるならそこへ**、分からなければ入力へ戻す。
  /// 「確認する」とだけ言って行き先の無いボタンを出さない。
  public init?(kit: WarningAction?, stopId: String?) {
    switch kit {
    case .none: return nil
    case .seeAlternatives: self = .openAlternatives
    case .seeWhatToRemove: self = .removeOptional
    case .reviewConditions: self = stopId.map { PlanWarningAction.openStop($0) } ?? .fixInput
    }
  }

  /// ボタンに出す文。Kit から写った 3 つは Kit の文をそのまま使い(Web と同じ一手には
  /// 同じ言葉)、アプリだけの 4 つは `AppCopy` から取る。
  public func label(_ locale: PlannerLocale) -> String {
    let app = AppCopy.for(locale)
    switch self {
    case .fixInput: return app.resolveEditInput
    case .chooseCountry: return app.chooseCountryAction
    case .chooseCandidate: return app.chooseCandidateAction
    case .openAlternatives: return WarningAction.seeAlternatives.label(locale)
    case .openStop: return WarningAction.reviewConditions.label(locale)
    case .removeOptional: return WarningAction.seeWhatToRemove.label(locale)
    case .retryBuild: return app.retryBuildAction
    }
  }
}

/// 結論の下に並ぶ「確認したいこと」の 1 行(統合仕様 §5.5)。
///
/// **種類ごとに 1 行**。同じ種類を 2 行出すと、旅行者は同じ心配を 2 件と数える —— それが
/// かつて「未確認の重要情報が10件」が 2 件の確認カードの上に乗っていた不具合の形だった。
public struct PlanIssue: Identifiable, Equatable, Sendable {

  /// 統合仕様 §5.5 が挙げる 8 種のうち、鍵ゼロのアプリで実際に起こる 6 種。残る 2 つ
  /// (ホテル取得失敗・組み立て失敗)は提供元を呼ばない経路には現れない。
  public enum Kind: String, Sendable, CaseIterable {
    case unresolvedInput, countryConflict, ambiguousPlace, deferredAnchor, openingHoursUnknown, computationLimit
  }

  public var kind: Kind
  public var text: String
  public var action: PlanWarningAction?

  public var id: String { kind.rawValue }

  public init(kind: Kind, text: String, action: PlanWarningAction?) {
    self.kind = kind
    self.text = text
    self.action = action
  }
}
