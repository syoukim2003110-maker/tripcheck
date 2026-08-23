import Foundation
import TripCheckKit

/*
 * 出発前チェック —— 旅程の後ろに置く「まだ紙の上で終わっていないこと」。
 *
 * 中身の判定は全部 Kit の `PreTripTimeline`(純関数)が持つ。この層がするのは、Kit が
 * 知りようのない 3 つを渡すことだけである:旅行者が名乗った旅券の国、端末に置いた有効期限、
 * そして今日。
 *
 * **門は Web と同じ**(`useTripDomainModel.tsx:724-734`):日本の旅券だと名乗ったときだけ
 * 入国条件と旅券規則を渡し、それ以外は両方 nil —— つまり一覧が空になる。他国の旅券に
 * 日本向けの条件を当てて「残存期間が不足」と言うのは、当たっていない可能性のほうが高く、
 * 外れたときの代償(取れたはずのビザを取らない・要らない更新をする)が大きい。
 *
 * 旅券の有効期限は `UserDefaults` に置く。**通信には出ない** —— この 1 件を誰かのサーバへ
 * 送る理由がどこにも無いし、送らないと決めておけば「送っていないか」を後から確かめる仕事も
 * 生まれない。
 */

/// 旅行者が名乗る旅券の国。Web の `PassportCountry`(`lib/planner-app-state.ts`)と同じ 3 値
/// で、**細かい国名は持たない** —— 個別判定の材料があるのは日本の旅券だけだからである。
public enum PassportCountry: String, Equatable, Sendable, CaseIterable {
  case unset, jp, other
}

/// 出発前チェックの 1 行。`PreTripItem` を画面の言葉に直したもので、`label` / `detail` は
/// もうロケールで引いてある。
public struct BeforeYouGoItem: Identifiable, Equatable, Sendable {
  public var id: String
  public var urgency: PreTripUrgency
  /// この旅に対する判定(「不足」「期間外」「〜までに申請」)。
  public var label: String
  /// 公式の要約。**判定は書かない** —— 判定は `label` の仕事で、両方が語ると食い違う。
  public var detail: String
  /// 公式ページ。読めない文字列は落ちる(`URL(string:)`)ので、押しても何も起きない
  /// リンクが画面に残らない。
  public var url: URL?
}

/// 出発前チェックのカード 1 枚ぶん。
public struct BeforeYouGoModel: Equatable, Sendable {
  public var passportCountry: PassportCountry
  /// `YYYY-MM-DD`。入れていなければ `nil`。
  public var passportExpiry: String?
  /// 期限のある宿題。旅券の国が日本でなければ**空**。
  public var items: [BeforeYouGoItem]
  /// 薬の持ち込み。国内の旅には出さない(Web と同じ門)。
  public var medicineLines: [String]
  /// 国ごとの基本(プラグ・緊急通報・交通パス・スト情報・入国条件)。
  public var essentials: [(label: String, value: String)]

  public static func == (lhs: BeforeYouGoModel, rhs: BeforeYouGoModel) -> Bool {
    lhs.passportCountry == rhs.passportCountry
      && lhs.passportExpiry == rhs.passportExpiry
      && lhs.items == rhs.items
      && lhs.medicineLines == rhs.medicineLines
      && lhs.essentials.count == rhs.essentials.count
      && zip(lhs.essentials, rhs.essentials).allSatisfy { $0.label == $1.label && $0.value == $1.value }
  }
}

extension PlannerStore {

  /// 旅券の有効期限を置く鍵。Web の `localStorage` と同じ名前(`TripPlannerShell.tsx:722`)——
  /// 同じ人が同じ端末で両方を使うことはないが、名前を揃えておくと「どこに置いたか」を
  /// 探す場所が 1 つで済む。
  static let passportExpiryKey = "tripcheck.passportExpiry"

  // MARK: - 旅行者が名乗る 2 つ

  /// 旅券の国。**保存しない** —— Web と同じで、国は判定を出してよいかの合図にすぎない。
  public func setPassportCountry(_ country: PassportCountry) {
    passportCountry = country
  }

  /// 旅券の有効期限。`nil`(と空文字)は「入れていない」で、鍵ごと消す —— 空文字を残すと、
  /// 次に開いたときに「入れたが空」と「入れていない」が見分けられない。
  public func setPassportExpiry(_ value: String?) {
    let trimmed = value?.trimmingCharacters(in: .whitespaces)
    if let trimmed, !trimmed.isEmpty {
      passportExpiry = trimmed
      defaults.set(trimmed, forKey: PlannerStore.passportExpiryKey)
    } else {
      passportExpiry = nil
      defaults.removeObject(forKey: PlannerStore.passportExpiryKey)
    }
  }

  // MARK: - カード 1 枚

  public var beforeYouGo: BeforeYouGoModel {
    let locale = request.locale
    let text = Copy.for(locale)
    let destination = activeDestination
    let essentials = destination.flatMap { Destinations.essentials($0) }

    // Web の門をそのまま:日本の旅券のときだけ規則を渡す。それ以外は両方 nil = 一覧は空。
    let isJapanese = passportCountry == .jp
    let items = PreTripTimeline.build(
      tripStartDate: tripDateRange.start,
      tripEndDate: tripDateRange.end,
      authority: isJapanese ? destination.flatMap { Destinations.entryAuthority($0) } : nil,
      passportRule: isJapanese ? destination.flatMap { Destinations.passportRule($0) } : nil,
      passportExpiry: isJapanese ? passportExpiry.flatMap { CalendarDate($0) } : nil,
      today: Self.todayUTC()
    )

    var rows: [(label: String, value: String)] = []
    if let essentials {
      rows.append((text.essentialsPlug, essentials.plug))
      if let emergency = essentials.emergency[locale] { rows.append((text.essentialsEmergency, emergency)) }
      // 入国条件は日本の旅券に向けて書かれた 1 行なので、名乗った人にだけ出す。
      if isJapanese {
        rows.append((text.essentialsEntry, locale == .ja ? essentials.entry.ja : essentials.entry.en))
      }
      if let pass = essentials.pass { rows.append((text.essentialsPass, locale == .ja ? pass.ja : pass.en)) }
      if let strike = essentials.strikeInfo { rows.append((text.beforeStrike, locale == .ja ? strike.ja : strike.en)) }
    }

    return BeforeYouGoModel(
      passportCountry: passportCountry,
      passportExpiry: passportExpiry,
      items: items.map { item in
        BeforeYouGoItem(
          id: item.id,
          urgency: item.urgency,
          label: item.label[locale] ?? item.label[.en] ?? "",
          detail: item.detail[locale] ?? item.detail[.en] ?? "",
          url: item.url.flatMap { URL(string: $0) }
        )
      },
      medicineLines: Self.needsMedicineNote(destination) ? [text.beforeMedication, text.beforeMedicationNote] : [],
      essentials: rows
    )
  }

  // MARK: - 内部

  /// いま話している行き先。組み上がっていればビルダーが決めた国(`auto` の自動検出後)、
  /// まだなら旅行者が選んだ国。どちらも無ければ `nil` —— **推測しない**。行き先を知らない
  /// まま「入国にはこれが要ります」と言うのは、当てずっぽうを事実の顔で出すことになる。
  private var activeDestination: Destination? {
    if let id = bundle?.plan.destination { return Destinations.byId(id) }
    guard case .destination(let id) = request.destination else { return nil }
    return Destinations.byId(id)
  }

  /// 旅の初日と最終日。組み上がっていれば**旅程の日**(到着便で 1 日目がずれる旅でも
  /// 締切が 1 日ずれない)、まだなら入力欄の開始日と日数から。日付を決めていない旅は
  /// 両方 `nil` で、Kit が締切を作らない。
  private var tripDateRange: (start: CalendarDate?, end: CalendarDate?) {
    if let dates = bundle?.plan.days.compactMap(\.date), let first = dates.first, let last = dates.last {
      return (CalendarDate(first), CalendarDate(last))
    }
    guard let start = request.tripStartDate.flatMap({ CalendarDate($0) }) else { return (nil, nil) }
    let days = max(1, request.tripDays ?? edit.tripDays)
    return (start, start.adding(days: days - 1))
  }

  /// 薬の持ち込みを言う相手。国内の旅と、行き先の決まっていない旅には出さない(Web
  /// `BeforeYouGoChecklist.tsx:72`)。
  private static func needsMedicineNote(_ destination: Destination?) -> Bool {
    guard let destination else { return false }
    return destination.id != .japan && destination.id != .worldwide
  }

  /// 今日(UTC の暦日)。Kit の `PreTripTimeline` は締切をこの 1 日と比べるだけで、
  /// 時刻は見ない —— 端末の時計が何時であっても、同じ日なら同じ答えになる。
  nonisolated static func todayUTC(_ instant: Date = Date()) -> CalendarDate {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    let parts = calendar.dateComponents([.year, .month, .day], from: instant)
    return CalendarDate(year: parts.year!, month: parts.month!, day: parts.day!)!
  }
}
