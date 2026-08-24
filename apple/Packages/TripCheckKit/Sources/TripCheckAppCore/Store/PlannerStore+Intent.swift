// Sources/TripCheckAppCore/Store/PlannerStore+Intent.swift
import Foundation
import TripCheckKit

/// 検索窓の「読み取る」行の見た目。
public enum IntentPhase: Equatable, Sendable {
  case idle, reading, failed
}

/*
 * 自由文 → 開始フォーム。LLM の答えはここで既存フォームの値になるだけで、旅程へ直接書く
 * 経路は無い(spec §1)。適用後はユーザーが目で確認してから構築する(確認ファースト)。
 */
extension PlannerStore {
  /// 行を出すか。可用性は起動時に composition root が決めている(parser の有無)ので、
  /// ここは決定的:parser が居て、文らしいか・読取中か・失敗表示中なら出す。
  public func intentRowVisible(for text: String) -> Bool {
    guard intentParser != nil else { return false }
    if intentPhase != .idle { return true }
    return IntentTrigger.looksLikeTripSentence(text)
  }

  /// 行が初めて見えたとき一度だけ。モデル資産の読み込みは秒単位なので、タップ前に温める。
  public func prewarmIntentIfNeeded() {
    guard !intentPrewarmed, let intentParser else { return }
    intentPrewarmed = true
    intentParser.prewarm()
  }

  /// 入力が変わった:読みかけは捨て、失敗表示は消す。
  public func intentQueryChanged() {
    intentGeneration += 1
    intentTask?.cancel()
    intentTask = nil
    if intentPhase != .idle { intentPhase = .idle }
  }

  /// 読み取り→フォーム展開。返り値は検索欄に置くべき文字列(行き先。無ければ "")。
  /// nil は「検索欄に触るな」(失敗・破棄)。
  @discardableResult
  public func readTripIntent(from text: String, now: Date = Date()) async -> String? {
    guard let intentParser, intentPhase != .reading else { return nil }
    intentGeneration += 1
    let generation = intentGeneration
    intentPhase = .reading
    let locale = request.locale
    let task = Task { await intentParser.parse(text, locale: locale) }
    intentTask = task
    let outcome = await task.value
    guard generation == intentGeneration else { return nil }   // 入力が変わった/リセットされた
    intentTask = nil
    guard case .parsed(let intent) = outcome else {
      intentPhase = .failed
      return nil
    }
    intentPhase = .idle
    apply(intent, now: now)
    if view.toast?.canUndo != true {
      showToast(Toast(text: AppCopy.for(request.locale).intentApplied, kind: .info))
    }
    return intent.destination
  }

  /// 決定的な適用。intent に無い欄は決してクリアしない(spec §4.4)。
  private func apply(_ intent: TripIntent, now: Date) {
    if let days = IntentResolution.days(fromDurationText: intent.durationText) {
      request.tripDays = days
    }
    if let date = IntentResolution.startDate(fromWhenText: intent.whenText, today: Self.calendarToday(now)) {
      request.tripStartDate = date
    }
    var seen = Set(request.entries.map { Self.dedupeKey($0.text) })
    for wish in intent.wishes {
      let name = wish.trimmingCharacters(in: .whitespacesAndNewlines)
      let key = Self.dedupeKey(name)
      guard !key.isEmpty, !seen.contains(key), canAddEntry else { continue }
      seen.insert(key)
      _ = addEntrySync(text: name)
    }
    refreshInputMode()
  }

  /// 大文字小文字・連続空白の違いを吸収した重複判定キー。
  static func dedupeKey(_ text: String) -> String {
    text.lowercased().split(whereSeparator: \.isWhitespace).joined(separator: " ")
  }

  /// 端末のローカル暦で「今日」。テストは now を注入する。
  static func calendarToday(_ now: Date) -> CalendarDate {
    let c = Calendar.current.dateComponents([.year, .month, .day], from: now)
    return CalendarDate(year: c.year ?? 2000, month: c.month ?? 1, day: c.day ?? 1)
      ?? CalendarDate(epochDay: 0)
  }
}
