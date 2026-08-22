import Foundation

/*
 * 「その訪問は表示されている時間帯の中に入っているか」を測る 1 つの述語。
 * `lib/planner-app-state.ts:421-441`(`clockToMinutes`、`clockRangeContainsVisit`)。
 *
 * Web ではこれが食事枠・推薦枠の**採用可否**を決める(`app/components/planner/hooks/usePlannerEdits.tsx:904`,
 * `:1018` —— 組み直した計画でその枠が窓の外に出ていたら、採用は成立しなかったものとして扱う)。
 * 編集の候補を評価する側の道具なので、この層に置く。
 *
 * TS `clockToMinutes`(`:421-424`)は移植しない —— Task 2 の `ClockTime(_:)`
 * (`Core/ClockTime.swift:13-20`)が同じ言語を受ける。TS の `^(?:([01]?\d|2[0-3])):([0-5]\d)$` は
 * 「時 0–23 の 1〜2 桁・分 00–59 の 2 桁・ASCII 数字のみ」で、`ClockTime` の検査と同じ集合
 * (`clockToMinutesIsTheClockTimeParser` が境界を固定する)。TS の `clockToMinutes(value)` は
 * Swift では `ClockTime(value)?.minutes` と書く。
 */
extension PlannerEdits {

  /// TS `clockRangeContainsVisit`(`lib/planner-app-state.ts:426-441`)。引数は TS と同じ 3 つ。
  ///
  /// 3 つの癖をそのまま移してある:
  ///   * 区切りは**エンダッシュ `–`(U+2013)だけ**(`:431` の `range.split("–")`)。ASCII の
  ///     ハイフンで書かれた範囲は解釈できず `false` になる —— 窓の文字列を作るのは目的地の
  ///     食事窓(`Destination.meals`)側で、そちらが常にエンダッシュを使う。
  ///   * 内側の `toMinutes`(`:427-430`)は `clockToMinutes` より**厳しい**:時も 2 桁必須
  ///     (`[01]\d|2[0-3]`)なので `"9:00"` は通らない。ここは `ClockTime` に長さの検査を足して再現する。
  ///   * 終わりが始まりより小さければ日を跨いだ窓(`+1440`)。訪問の開始・終了も窓の側へ
  ///     繰り上げてから比べる(`:437-439` の 2 つの `while`)。
  ///
  /// 4 つのうち 1 つでも読めなければ `false`(`:436`)—— 読めない窓は「入っている」と言わない。
  public static func clockRangeContainsVisit(range: String, arrival: String, departure: String) -> Bool {
    // TS の内側 `toMinutes`。`count == 5` かつ 3 文字目が ":" は「時が 2 桁」の言い換えで、
    // 残りの検査(数字のみ・0...23・0...59)は `ClockTime` がそのまま持っている。
    func toMinutes(_ value: String) -> Int? {
      guard value.count == 5, Array(value)[2] == ":" else { return nil }
      return ClockTime(value)?.minutes
    }
    let parts = range.components(separatedBy: "–")
    guard let start = toMinutes(parts.first ?? ""),
          let parsedEnd = toMinutes(parts.count > 1 ? parts[1] : ""),
          let parsedVisitStart = toMinutes(arrival),
          let parsedVisitEnd = toMinutes(departure)
    else { return false }

    var end = parsedEnd
    var visitStart = parsedVisitStart
    var visitEnd = parsedVisitEnd
    if end < start { end += 1440 }
    while visitStart < start { visitStart += 1440 }
    while visitEnd < visitStart { visitEnd += 1440 }
    return visitStart >= start && visitEnd <= end
  }
}
