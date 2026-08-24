# 自由文インテント(Foundation Models)実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 開始画面の検索窓に書いた自由文(「9月に2泊で金沢…」)を端末内 LLM が開始フォームの値に落とし、ユーザー確認後は従来パイプラインがそのまま旅程を組む。

**Architecture:** 実経路と同じミラー型シーム。Kit(Foundation のみ)に型・文らしさ判定・表記→値の決定的パーサ、AppCore に `@available(iOS 26)` の FoundationModels 実装と Canned 差し替えとストア拡張、アプリ層は候補リスト先頭の行1つ+注入。LLM は「本文の表記を写す」だけで、暦・泊数の計算と適用はすべて決定的な Swift。

**Tech Stack:** Swift 6 / SwiftUI / Swift Testing(unit)+ XCTest(UI)/ FoundationModels(iOS 26, guided generation, temperature 0)

**Spec:** `docs/superpowers/specs/2026-08-24-tripcheck-intent-design.md`(コミット 1dbe738 + 本計画と同時の精密化修正)

**Base:** branch `claude/architecture-v2`(1dbe738)から worktree `claude/swift-intent` を切る。

## Global Constraints

- web 側 `lib/` `app/` `tests/` は不可侵。変更は `apple/` 配下のみ。
- TripCheckKit ターゲットは Foundation のみ import(`Invariants/ImportBoundaryTests.swift` が検査)。Kit の既存公開 API は変更せず追加のみ。
- `PlannerCopy`(267 キー)不変。fixtures バイト同一。UI 文言は `AppCopy` に追加し `AppCopyTests` のカウントを実測値へ更新。
- Swift 6 strict concurrency。`apple/tools/verify-kit.sh` と `apple/tools/verify-app.sh test` が警告ゼロで緑。
- コピーに絵文字なし(`BannedTerms` 検査を通ること)。
- LLM の役割は理解のみ。生成文をそのまま画面・旅程に出す実装は spec §1 違反。パースごとに新品 `LanguageModelSession`、`temperature: 0.0`、抽出は本文の表記のまま(spec §4.2)。
- `TripIntent` は保存・共有リンクに入れない(spec §6)。
- コミットメッセージ末尾に次の2行:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J`
- `git push` はしない。

**計画時の裁定(ledger 転記用):**
1. StartScreen はトーストを一切描画していない(既存の12件上限トーストにも表示先がない潜在バグ)。Task 6 で `ToastView` 描画を StartScreen に追加する — intentApplied の表示先であり、既存バグの修正でもある。
2. 可用性判定は composition root(`IntentAvailability.makeDefaultParser`)に閉じ込め、ストアは「parser が注入されているか」だけを見る。ユニットテストがホストの Apple Intelligence 状態に依存しないため。モデルが起動後に利用可能化するケースは次回起動で拾う(v1 許容)。
3. ウィッシュ適用は `addEntry(text:suggestion:)` でなく `addEntrySync` + `refreshInputMode()`(importPasted と同じ扱い)。`addEntry` の上限トーストが適用ループ中に連発するのを避ける。
4. UI テストの入力文は ASCII(「Weekend trip to Kanazawa, seafood and museum」)。シミュレータへの日本語 typeText は不安定なため。判定は空白+12字規則で発火し、Canned は入力に依らず同じ答えを返すので成立する。
5. Canned の durationText は「3泊」(→4日)。フォーム既定の tripDays=3 と区別できる値にして、適用が起きたことをテストで観測可能にする。

---

### Task 1: Kit — TripIntent 型・IntentParser プロトコル・IntentTrigger

**Files:**
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckKit/Intent/TripIntent.swift`
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckKit/Intent/IntentTrigger.swift`
- Test: `apple/Packages/TripCheckKit/Tests/TripCheckKitTests/IntentTests.swift`

**Interfaces:**
- Consumes: `PlannerLocale`(`Sources/TripCheckKit/Core/PlannerLocale.swift` — `public enum PlannerLocale: String, Codable, Sendable { case ja, en }`)
- Produces: `TripIntent`(4欄+`isEmpty`)、`IntentOutcome`(`.parsed/.failed`)、`protocol IntentParser: Sendable`(`parse(_:locale:) async -> IntentOutcome` + 既定 no-op の `prewarm()`)、`IntentTrigger.looksLikeTripSentence(_:) -> Bool`。Task 2〜6 が全部これを使う。

- [ ] **Step 1: 失敗するテストを書く** — `IntentTests.swift` を新規作成:

```swift
import Testing
@testable import TripCheckKit

// 「文らしさ」判定 —— spec §4.1 の表そのまま。行を出すかを毎キー入力で決めるので純粋・即答。
@Test func aBarePlaceNameIsNotASentence() {
  #expect(!IntentTrigger.looksLikeTripSentence("金沢"))
  #expect(!IntentTrigger.looksLikeTripSentence(""))
  #expect(!IntentTrigger.looksLikeTripSentence("  金沢  "))
}

@Test func japaneseTripMarkersMakeASentence() {
  #expect(IntentTrigger.looksLikeTripSentence("9月に2泊で金沢に行きたい。海鮮と美術館めぐり"))
  #expect(IntentTrigger.looksLikeTripSentence("日帰りで鎌倉"))
  #expect(IntentTrigger.looksLikeTripSentence("沖縄でのんびりしたい"))
}

@Test func twoShortWordsWithASpaceAreNotASentence() {
  #expect(!IntentTrigger.looksLikeTripSentence("沖縄 ホテル"))
}

@Test func aLongSpacedEnglishLineIsASentence() {
  #expect(IntentTrigger.looksLikeTripSentence("Weekend trip to Kyoto, want temples and good coffee."))
}

@Test func shortMarkerTextStillFires() {
  #expect(IntentTrigger.looksLikeTripSentence("3泊で沖縄"))
}

// 全欄空だけが isEmpty —— 埋めるものが無い答えは .failed に落とすための判定(spec §4.2)。
@Test func onlyABlankIntentIsEmpty() {
  #expect(TripIntent(destination: "", durationText: "", whenText: "", wishes: []).isEmpty)
  #expect(!TripIntent(destination: "金沢", durationText: "", whenText: "", wishes: []).isEmpty)
  #expect(!TripIntent(destination: "", durationText: "2泊", whenText: "", wishes: []).isEmpty)
  #expect(!TripIntent(destination: "", durationText: "", whenText: "9月", wishes: []).isEmpty)
  #expect(!TripIntent(destination: "", durationText: "", whenText: "", wishes: ["海鮮"]).isEmpty)
}
```

- [ ] **Step 2: 落ちることを確認** — `cd apple/Packages/TripCheckKit && swift test --filter IntentTests` → コンパイルエラー(型が無い)で FAIL。
- [ ] **Step 3: 実装** — `TripIntent.swift`:

```swift
// Sources/TripCheckKit/Intent/TripIntent.swift
import Foundation

/// 自由文から抜き出した旅の条件。値はすべて本文の表記のまま —— 暦や泊数の計算は
/// `IntentResolution`(決定的コード)の仕事で、LLM には写すことしかさせない(spec §4.2)。
public struct TripIntent: Hashable, Sendable, Codable {
  /// 行き先の地名。無ければ ""。
  public var destination: String
  /// 「2泊」「3日間」など。無ければ ""。
  public var durationText: String
  /// 「9月」「10月3日から」など。無ければ ""。
  public var whenText: String
  /// やりたいこと・食べたいもの・行きたい場所。本文に書かれたものだけ。
  public var wishes: [String]

  public init(destination: String, durationText: String, whenText: String, wishes: [String]) {
    self.destination = destination
    self.durationText = durationText
    self.whenText = whenText
    self.wishes = wishes
  }

  /// 全欄が空 —— 埋めるものが無いので `.failed` に落とす(spec §4.2)。
  public var isEmpty: Bool {
    destination.isEmpty && durationText.isEmpty && whenText.isEmpty && wishes.isEmpty
  }
}

public enum IntentOutcome: Hashable, Sendable {
  case parsed(TripIntent)
  /// タイムアウト・モデルエラー・全欄空。どこにもキャッシュしない(spec §4.5)。
  case failed
}

/// 聞き取り係の約束。`RouteProvider` と同じ構え —— Kit は提供元を知らない。
public protocol IntentParser: Sendable {
  func parse(_ text: String, locale: PlannerLocale) async -> IntentOutcome
  /// 行が初めて見えたときに一度呼ばれる。モデル資産の先読み。既定は何もしない。
  func prewarm()
}

extension IntentParser {
  public func prewarm() {}
}
```

`IntentTrigger.swift`:

```swift
// Sources/TripCheckKit/Intent/IntentTrigger.swift
import Foundation

/// 「文らしい」かの決定的判定。LLM は使わない —— 毎キー入力で評価されるので、
/// ここは純粋・即答・無料でなければならない(spec §4.1)。誤発火のコストは行が1つ
/// 増えるだけなので、出す側に倒してある。
public enum IntentTrigger {
  static let markers = ["泊", "日間", "日帰り", "したい", "行きたい", "旅", "。", "、"]

  public static func looksLikeTripSentence(_ text: String) -> Bool {
    let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard t.count >= 4 else { return false }
    if markers.contains(where: { t.contains($0) }) { return true }
    return t.contains(where: \.isWhitespace) && t.count >= 12
  }
}
```

- [ ] **Step 4: 通ることを確認** — `swift test --filter IntentTests` → PASS。
- [ ] **Step 5: 全体検証** — `apple/tools/verify-kit.sh` → 緑・警告ゼロ(ImportBoundaryTests が新ファイルの Foundation-only を確認する)。
- [ ] **Step 6: コミット** — `git add apple/Packages/TripCheckKit && git commit`(メッセージは平叙文+規定トレーラ)。

---

### Task 2: Kit — IntentResolution(表記→日数・日付の決定的パーサ)

**Files:**
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckKit/Intent/IntentResolution.swift`
- Test: `apple/Packages/TripCheckKit/Tests/TripCheckKitTests/IntentResolutionTests.swift`

**Interfaces:**
- Consumes: `CalendarDate`(`Core/CalendarDate.swift` — `init?(year:month:day:)` は妥当性検査つき、`Comparable`、`description` は "YYYY-MM-DD")、`EngineConstants.tripDaysRange`(= `1...14`)
- Produces: `IntentResolution.days(fromDurationText:) -> Int?`、`IntentResolution.startDate(fromWhenText:today:) -> String?`。Task 5 の適用ロジックが使う。

- [ ] **Step 1: 失敗するテストを書く** — `IntentResolutionTests.swift`:

```swift
import Testing
@testable import TripCheckKit

// spec §4.3 の表そのまま。読めない表記は黙って nil —— 推測で埋めない。
@Test func nightsBecomeDaysByAddingOne() {
  #expect(IntentResolution.days(fromDurationText: "2泊") == 3)
  #expect(IntentResolution.days(fromDurationText: "2泊3日") == 3)
  #expect(IntentResolution.days(fromDurationText: "3日間") == 3)
  #expect(IntentResolution.days(fromDurationText: "3日") == 3)
  #expect(IntentResolution.days(fromDurationText: "日帰り") == 1)
  #expect(IntentResolution.days(fromDurationText: "Weekend") == nil)
  #expect(IntentResolution.days(fromDurationText: "") == nil)
}

@Test func fullWidthDigitsCount() {
  #expect(IntentResolution.days(fromDurationText: "2泊") == 3)
}

@Test func absurdDurationsClampToTheAllowedRange() {
  #expect(IntentResolution.days(fromDurationText: "30泊") == 14)
  #expect(IntentResolution.days(fromDurationText: "0日") == 1)
}

@Test func aMonthAndDayLandOnTheNextOccurrence() {
  let today = CalendarDate("2026-08-24")!
  #expect(IntentResolution.startDate(fromWhenText: "10月3日から", today: today) == "2026-10-03")
  #expect(IntentResolution.startDate(fromWhenText: "10/3", today: today) == "2026-10-03")
  // 年内で過ぎた日付は翌年へ。
  #expect(IntentResolution.startDate(fromWhenText: "3月1日", today: today) == "2027-03-01")
  // 今日ちょうどは今日。
  #expect(IntentResolution.startDate(fromWhenText: "8月24日", today: today) == "2026-08-24")
}

@Test func aFullDateIsHonoredUnlessPast() {
  let today = CalendarDate("2026-08-24")!
  #expect(IntentResolution.startDate(fromWhenText: "2026年10月3日", today: today) == "2026-10-03")
  #expect(IntentResolution.startDate(fromWhenText: "2026-10-03", today: today) == "2026-10-03")
  #expect(IntentResolution.startDate(fromWhenText: "2024-09-01", today: today) == nil)
}

@Test func vagueTimingStaysUndated() {
  let today = CalendarDate("2026-08-24")!
  #expect(IntentResolution.startDate(fromWhenText: "9月", today: today) == nil)
  #expect(IntentResolution.startDate(fromWhenText: "来週末", today: today) == nil)
  #expect(IntentResolution.startDate(fromWhenText: "", today: today) == nil)
  // 存在しない日は素直に nil(2/30 など)。
  #expect(IntentResolution.startDate(fromWhenText: "2月30日", today: today) == nil)
}
```

- [ ] **Step 2: 落ちることを確認** — `swift test --filter IntentResolutionTests` → FAIL。
- [ ] **Step 3: 実装** — `IntentResolution.swift`:

```swift
// Sources/TripCheckKit/Intent/IntentResolution.swift
import Foundation

/// 表記(「2泊」「10月3日から」)を値へ落とす決定的パーサ。LLM に暦をやらせると年も日も
/// 捏造する(spec §8-1)ので、計算はぜんぶここ。読めない表記は黙って nil。
public enum IntentResolution {
  /// 「N泊」→N+1、「N泊M日」→M、「N日間/N日」→N、「日帰り」→1。範囲は 1...14 にクランプ。
  public static func days(fromDurationText text: String) -> Int? {
    let t = normalized(text)
    if t.contains("日帰り") { return clamp(1) }
    if let m = t.firstMatch(of: /([0-9]+)泊([0-9]+)日/), let d = Int(m.2) { return clamp(d) }
    if let m = t.firstMatch(of: /([0-9]+)泊/), let n = Int(m.1) { return clamp(n + 1) }
    if let m = t.firstMatch(of: /([0-9]+)日/), let d = Int(m.1) { return clamp(d) }
    return nil
  }

  /// 月+日が揃った表記だけ日付になる。年無しは today 以降の直近(過ぎていれば翌年)、
  /// 年ありは過去なら nil。「9月」「来週末」は nil = 日付未定の旅(spec §4.3)。
  public static func startDate(fromWhenText text: String, today: CalendarDate) -> String? {
    let t = normalized(text)
    if let m = t.firstMatch(of: /([0-9]{4})[年-]([0-9]{1,2})[月-]([0-9]{1,2})日?/),
       let y = Int(m.1), let mo = Int(m.2), let d = Int(m.3) {
      guard let date = CalendarDate(year: y, month: mo, day: d), date >= today else { return nil }
      return date.description
    }
    if let m = t.firstMatch(of: /([0-9]{1,2})[月\/]([0-9]{1,2})日?/),
       let mo = Int(m.1), let d = Int(m.2) {
      guard let thisYear = CalendarDate(year: today.year, month: mo, day: d) else { return nil }
      if thisYear >= today { return thisYear.description }
      return CalendarDate(year: today.year + 1, month: mo, day: d)?.description
    }
    return nil
  }

  private static func clamp(_ d: Int) -> Int {
    min(max(d, EngineConstants.tripDaysRange.lowerBound), EngineConstants.tripDaysRange.upperBound)
  }

  /// 全角数字→半角。他の文字はそのまま。
  private static func normalized(_ text: String) -> String {
    String(text.map { ch in
      guard ch.unicodeScalars.count == 1, let v = ch.unicodeScalars.first?.value,
            (0xFF10...0xFF19).contains(v), let scalar = UnicodeScalar(v - 0xFF10 + 0x30) else { return ch }
      return Character(scalar)
    })
  }
}
```

- [ ] **Step 4: 通ることを確認** — `swift test --filter IntentResolutionTests` → PASS。
- [ ] **Step 5: 全体検証** — `apple/tools/verify-kit.sh` → 緑・警告ゼロ。
- [ ] **Step 6: コミット**。

---

### Task 3: AppCore — FoundationModelsIntentParser(本物の聞き取り係)

**Files:**
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Intent/FoundationModelsIntentParser.swift`
- Modify(必要時のみ): `apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Invariants/ImportBoundaryTests.swift`

**Interfaces:**
- Consumes: Task 1 の `IntentParser` / `TripIntent` / `IntentOutcome`。FoundationModels(`LanguageModelSession`, `@Generable`, `@Guide`, `GenerationOptions`, `SystemLanguageModel`)。
- Produces: `@available(iOS 26.0, macOS 26.0, *) public struct FoundationModelsIntentParser: IntentParser`、`public init(timeout: Duration = .seconds(20))`。Task 4 の `IntentAvailability` が生成する。

このタスクの実装は 2026-08-24 の開発機プローブで動作確認済みの API 形状(spec §8)。**本物の LLM を呼ぶ自動テストは書かない**(ホストの Apple Intelligence 状態に依存するため — spec §7)。決定性のある部分(全欄空→failed)は Task 1 の `isEmpty` が既にテストしている。

- [ ] **Step 1: まず `ImportBoundaryTests.swift` を読む** — AppCore ターゲットの import を検査・制限している場合は `FoundationModels` を許可リストへ追加(Kit ターゲット側の規則には触らない)。検査が Kit のみなら変更不要。
- [ ] **Step 2: 実装** — `FoundationModelsIntentParser.swift`:

```swift
// Sources/TripCheckAppCore/Intent/FoundationModelsIntentParser.swift
import Foundation
import FoundationModels
import TripCheckKit

/// 端末内 LLM(Foundation Models)の聞き取り係。写経だけをさせる ——「本文の表記のまま」を
/// instructions と @Guide の両方で縛り、暦・泊数の計算は Kit の `IntentResolution` に渡す。
///
/// パースごとに新品セッション:セッションは履歴を持ち、使い回すと前回の答えが単語入力に
/// 混入する(spec §8-4 で実測)。temperature 0(解釈に賭けは要らない)。
/// 番犬は `AppleRouteProvider.race` と同じ withTaskGroup + Task.sleep。SDK 側のネイティブ
/// キャンセルは公開されていないので、負けた生成は答えを捨てるだけ(結果は世代検査で守る)。
@available(iOS 26.0, macOS 26.0, *)
public struct FoundationModelsIntentParser: IntentParser {
  static let instructions =
    "旅行の希望を書いた文から条件を抜き出す。値は必ず本文に書かれた表記のまま写す。本文に無い情報は決して補わない。"

  @Generable
  struct GeneratedIntent {
    @Guide(description: "旅の行き先の地名。本文の表記のまま。無ければ空文字。")
    var destination: String
    @Guide(description: "泊数・日数の表現を本文の表記のまま。例:「2泊」「3日間」「2泊3日」。無ければ空文字。")
    var durationText: String
    @Guide(description: "時期・日付の表現を本文の表記のまま。例:「9月」「10月3日から」「来週末」。無ければ空文字。")
    var whenText: String
    @Guide(description: "やりたいこと・食べたいもの・行きたい場所の項目。本文に書かれたものだけ。")
    var wishes: [String]
  }

  let timeout: Duration

  public init(timeout: Duration = .seconds(20)) {
    self.timeout = timeout
  }

  public func prewarm() {
    LanguageModelSession(instructions: Self.instructions).prewarm()
  }

  public func parse(_ text: String, locale: PlannerLocale) async -> IntentOutcome {
    let timeout = self.timeout
    return await withTaskGroup(of: IntentOutcome.self) { group in
      group.addTask {
        do {
          let session = LanguageModelSession(instructions: Self.instructions)
          let response = try await session.respond(
            to: text, generating: GeneratedIntent.self,
            options: GenerationOptions(temperature: 0.0))
          let g = response.content
          let intent = TripIntent(
            destination: g.destination.trimmingCharacters(in: .whitespacesAndNewlines),
            durationText: g.durationText,
            whenText: g.whenText,
            wishes: g.wishes
              .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
              .filter { !$0.isEmpty })
          return intent.isEmpty ? .failed : .parsed(intent)
        } catch {
          return .failed
        }
      }
      group.addTask {
        try? await Task.sleep(for: timeout)
        return .failed
      }
      let first = await group.next() ?? .failed
      group.cancelAll()
      return first
    }
  }
}
```

コンパイルが `@Generable`/`@Guide`/`respond(to:generating:options:)` の形で通らない場合は、まず開発機で `swift -e` によるミニプローブ(spec §8 の手順)で正しい形を確かめてから直す — 当てずっぽうで API 名を変えない。

- [ ] **Step 3: 検証** — `apple/tools/verify-kit.sh` → 緑・警告ゼロ(macOS ホストビルドで @available ゲートが正しいことの確認になる)。
- [ ] **Step 4: コミット**。

---

### Task 4: AppCore — CannedIntentParser + IntentAvailability

**Files:**
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Intent/CannedIntentParser.swift`
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Intent/IntentAvailability.swift`
- Test: `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/IntentParserTests.swift`

**Interfaces:**
- Consumes: Task 1 の型、Task 3 の `FoundationModelsIntentParser`、`SystemLanguageModel.default.availability`
- Produces: `public struct CannedIntentParser: IntentParser`(`public init()`)、`IntentAvailability.makeDefaultParser(uiTesting: Bool) -> (any IntentParser)?`。Task 6 の `TripCheckApp` が呼ぶ。

- [ ] **Step 1: 失敗するテストを書く** — `IntentParserTests.swift`:

```swift
import Testing
@testable import TripCheckAppCore
import TripCheckKit

// 通信しない決定的な聞き取り係 —— 入力に依らず同じ答え。UI テストはこの値を前提に書く。
@Test func theCannedParserAlwaysReturnsTheSameIntent() async {
  let expected = TripIntent(
    destination: "金沢", durationText: "3泊", whenText: "", wishes: ["海鮮", "21世紀美術館"])
  #expect(await CannedIntentParser().parse("anything", locale: .ja) == .parsed(expected))
  #expect(await CannedIntentParser().parse("別の入力", locale: .en) == .parsed(expected))
}

// -uiTesting では必ず Canned —— シミュレータのホスト状態に依存させない(spec §4.5)。
@Test func uiTestingAlwaysGetsTheCannedParser() {
  #expect(IntentAvailability.makeDefaultParser(uiTesting: true) as? CannedIntentParser != nil)
}
```

- [ ] **Step 2: 落ちることを確認** — `swift test --filter IntentParserTests` → FAIL。
- [ ] **Step 3: 実装** — `CannedIntentParser.swift`:

```swift
// Sources/TripCheckAppCore/Intent/CannedIntentParser.swift
import Foundation
import TripCheckKit

/// 通信しない決定的な聞き取り係。`-uiTesting` の注入先(`TripCheckApp`)。
///
/// 入力に依らず同じ答えを返す —— UI テストはこの canned 値を前提に書く。durationText は
/// 「3泊」(→4日):フォーム既定の tripDays=3 と区別できる値にして、適用が起きたことを
/// 観測可能にしてある(計画の裁定5)。
public struct CannedIntentParser: IntentParser {
  public init() {}

  public func parse(_ text: String, locale: PlannerLocale) async -> IntentOutcome {
    .parsed(TripIntent(
      destination: "金沢", durationText: "3泊", whenText: "", wishes: ["海鮮", "21世紀美術館"]))
  }
}
```

`IntentAvailability.swift`:

```swift
// Sources/TripCheckAppCore/Intent/IntentAvailability.swift
import Foundation
import FoundationModels
import TripCheckKit

/// 起動時に一度だけ選ぶ:誰が聞き取り係か。可用性の判定はここ(composition root)に
/// 閉じ込め、ストアは「parser が注入されているか」だけを見る —— ユニットテストをホストの
/// Apple Intelligence 状態から切り離すための構え(計画の裁定2)。モデルが起動後に利用可能に
/// なるケースは次回起動で拾う(v1 許容)。
public enum IntentAvailability {
  public static func makeDefaultParser(uiTesting: Bool) -> (any IntentParser)? {
    if uiTesting { return CannedIntentParser() }
    guard #available(iOS 26.0, macOS 26.0, *) else { return nil }
    guard case .available = SystemLanguageModel.default.availability else { return nil }
    return FoundationModelsIntentParser()
  }
}
```

- [ ] **Step 4: 通ることを確認** — `swift test --filter IntentParserTests` → PASS。
- [ ] **Step 5: 全体検証** — `apple/tools/verify-kit.sh` → 緑・警告ゼロ。
- [ ] **Step 6: コミット**。

---

### Task 5: AppCore — ストア統合(状態・適用・コピー)

**Files:**
- Modify: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store/PlannerStore.swift`(クラス本体に状態+init 引数。`// MARK: - 実経路` グループの後に `// MARK: - 自由文インテント` を作る)
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store/PlannerStore+Intent.swift`
- Modify: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Presentation/AppCopy.swift`(フィールド4つ+ja 表+en 表)
- Modify: `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/AppCopyTests.swift`(配列に4キー追加、`#expect(checked == 460)` → `468`、集計コメントに `+ 8` を追記)
- Modify: `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/Support/Fakes.swift`(`FakeIntentParser` と `IntentLatch` を追加)
- Test: `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/IntentFlowTests.swift`

**Interfaces:**
- Consumes: Task 1/2 の Kit API、既存 `addEntrySync(text:)`・`canAddEntry`・`refreshInputMode()`(`PlannerStore+Start.swift:24,19,171`)、`showToast(_:)`(`PlannerStore+Edits.swift:293`)、`Toast(text:kind:canUndo:)`、`request.tripDays: Int?` / `request.tripStartDate: String?`(`State/TripRequestState.swift:31,33`)
- Produces: `PlannerStore.init(..., intentParser: (any IntentParser)? = nil)`(既存引数列の末尾に追加)、`intentPhase: IntentPhase`、`intentRowVisible(for:) -> Bool`、`prewarmIntentIfNeeded()`、`intentQueryChanged()`、`readTripIntent(from:now:) async -> String?`、AppCopy キー `intentRowTitle/intentParsing/intentFailed/intentApplied`。Task 6 の UI が使う。

- [ ] **Step 1: 失敗するテストを書く** — `IntentFlowTests.swift`:

```swift
import Foundation
import Testing
@testable import TripCheckAppCore
import TripCheckKit

// 成功:表記が決定的パーサを通ってフォームの値になり、行き先が返る。
@Test @MainActor func aParsedIntentFillsTheStartForm() async {
  let parser = FakeIntentParser(outcome: .parsed(TripIntent(
    destination: "金沢", durationText: "2泊", whenText: "10月3日から", wishes: ["海鮮", "21世紀美術館"])))
  let store = PlannerStore(resolvers: [], store: nil, intentParser: parser)
  let query = await store.readTripIntent(
    from: "10月3日から2泊で金沢", now: ISO8601DateFormatter().date(from: "2026-08-24T09:00:00+09:00")!)
  #expect(query == "金沢")
  #expect(store.request.tripDays == 3)
  #expect(store.request.tripStartDate == "2026-10-03")
  #expect(store.request.entries.map(\.text) == ["海鮮", "21世紀美術館"])
  #expect(store.intentPhase == .idle)
  #expect(store.view.toast?.text == AppCopy.for(store.request.locale).intentApplied)
}

// intent に無い欄は触らない:フォーム既定(tripDays=3・日付なし)がそのまま残る。
@Test @MainActor func missingFieldsNeverClobberTheForm() async {
  let parser = FakeIntentParser(outcome: .parsed(TripIntent(
    destination: "", durationText: "", whenText: "9月", wishes: ["温泉"])))
  let store = PlannerStore(resolvers: [], store: nil, intentParser: parser)
  store.request.tripDays = 5
  let query = await store.readTripIntent(from: "9月に温泉に行きたい")
  #expect(query == "")           // 行き先なし → 検索欄は空に戻す
  #expect(store.request.tripDays == 5)
  #expect(store.request.tripStartDate == nil)   // 「9月」は日付未定のまま
  #expect(store.request.entries.map(\.text) == ["温泉"])
}

// 重複(大文字小文字・空白違い)はスキップ、12件上限は残り枠だけ。
@Test @MainActor func wishesDedupeAndRespectThePlaceLimit() async {
  let parser = FakeIntentParser(outcome: .parsed(TripIntent(
    destination: "", durationText: "", whenText: "",
    wishes: ["Louvre", " louvre ", "海鮮", "海鮮", "凱旋門"])))
  let store = PlannerStore(resolvers: [], store: nil, intentParser: parser)
  for i in 1...10 { _ = store.addEntrySync(text: "場所\(i)") }
  _ = store.addEntrySync(text: "louvre")
  _ = await store.readTripIntent(from: "美術館めぐりがしたい")
  // 既存11件+新規1件(Louvre は既存と重複、海鮮が1枠、凱旋門は上限落ち)。
  #expect(store.request.entries.count == 12)
  #expect(store.request.entries.last?.text == "海鮮")
}

// 失敗:フォームは無傷、phase だけ .failed。新しい入力で消える。
@Test @MainActor func aFailedParseLeavesTheFormAloneAndFlagsTheRow() async {
  let store = PlannerStore(resolvers: [], store: nil, intentParser: FakeIntentParser(outcome: .failed))
  let query = await store.readTripIntent(from: "9月に2泊で金沢")
  #expect(query == nil)
  #expect(store.request.entries.isEmpty)
  #expect(store.intentPhase == .failed)
  store.intentQueryChanged()
  #expect(store.intentPhase == .idle)
}

// 読みかけ中に入力が変わったら、答えは捨てる(遅れて着いた答えがフォームを汚さない)。
@Test(.timeLimit(.minutes(2))) @MainActor func aStaleAnswerNeverLandsOnTheForm() async {
  let latch = IntentLatch()
  let store = PlannerStore(resolvers: [], store: nil, intentParser: LatchedIntentParser(latch: latch))
  async let result = store.readTripIntent(from: "9月に2泊で金沢")
  await latch.waitUntilCalled()
  store.intentQueryChanged()     // ユーザーが入力を変えた
  await latch.release()
  #expect(await result == nil)
  #expect(store.request.entries.isEmpty)
  #expect(store.intentPhase == .idle)
}

// Undo トーストが出ている間は譲る(実経路 T6 の規律)。
@Test @MainActor func anUndoToastIsNeverClobberedByTheIntentToast() async {
  let parser = FakeIntentParser(outcome: .parsed(TripIntent(
    destination: "金沢", durationText: "", whenText: "", wishes: [])))
  let store = PlannerStore(resolvers: [], store: nil, intentParser: parser)
  let undo = Toast(text: "戻せます", kind: .edit, canUndo: true)
  store.view.toast = undo
  _ = await store.readTripIntent(from: "金沢に行きたい")
  #expect(store.view.toast == undo)
}

// 行の可視条件:parser の有無 × 文らしさ × phase。
@Test @MainActor func theRowShowsForSentencesAndWhileBusyOrFailed() {
  let store = PlannerStore(resolvers: [], store: nil, intentParser: FakeIntentParser())
  #expect(store.intentRowVisible(for: "9月に2泊で金沢に行きたい"))
  #expect(!store.intentRowVisible(for: "金沢"))
  store.intentPhase = .failed
  #expect(store.intentRowVisible(for: "金沢"))   // 失敗表示は入力が変わるまで残る
  let bare = PlannerStore(resolvers: [], store: nil)
  #expect(!bare.intentRowVisible(for: "9月に2泊で金沢に行きたい"))
}

// prewarm は一度だけ。
@Test @MainActor func prewarmHappensOnce() {
  let store = PlannerStore(resolvers: [], store: nil, intentParser: FakeIntentParser())
  store.prewarmIntentIfNeeded()
  store.prewarmIntentIfNeeded()
  #expect(store.intentPrewarmed)
}
```

`Fakes.swift` に追加(既存のフェイク群と同じ「なぜこの形か」コメント様式で):

```swift
/// 決められた答えを返す聞き取り係。outcome を差し替えて成功も失敗も演じる。
struct FakeIntentParser: IntentParser {
  var outcome: IntentOutcome = .parsed(TripIntent(
    destination: "金沢", durationText: "3泊", whenText: "", wishes: ["海鮮"]))
  func parse(_ text: String, locale: PlannerLocale) async -> IntentOutcome { outcome }
}

/// 呼ばれたことを合図し、放すまで答えを返さない聞き取り係。読みかけ中の割り込みを
/// 決定的に作る(壁時計 sleep は並列スイートで飢えるため使わない —— RouteLatch と同じ教訓)。
actor IntentLatch {
  private var called = false
  private var releaseWaiters: [CheckedContinuation<Void, Never>] = []
  private var callWaiters: [CheckedContinuation<Void, Never>] = []
  private var released = false
  func markCalled() {
    called = true
    for w in callWaiters { w.resume() }
    callWaiters = []
  }
  func waitUntilCalled() async {
    if called { return }
    await withCheckedContinuation { callWaiters.append($0) }
  }
  func release() {
    released = true
    for w in releaseWaiters { w.resume() }
    releaseWaiters = []
  }
  func waitUntilReleased() async {
    if released { return }
    await withCheckedContinuation { releaseWaiters.append($0) }
  }
}

/// ラッチが開くまで答えない聞き取り係。release を await より先に呼ぶこと(ラッチは
/// キャンセルを見ない)。
struct LatchedIntentParser: IntentParser {
  let latch: IntentLatch
  func parse(_ text: String, locale: PlannerLocale) async -> IntentOutcome {
    await latch.markCalled()
    await latch.waitUntilReleased()
    return .parsed(TripIntent(destination: "遅い答え", durationText: "", whenText: "", wishes: ["遅い答え"]))
  }
}
```

(`Tests/TripCheckAppCoreTests/Support/` に既に `RouteLatch` がある場合は、その実装を読んで同じ形式に合わせる。流用できるなら `IntentLatch` を作らず共用してよい — その判断はレポートに書く。)

- [ ] **Step 2: 落ちることを確認** — `swift test --filter IntentFlowTests` → FAIL(API 未実装)。
- [ ] **Step 3: 実装** — `PlannerStore.swift` クラス本体(`// MARK: - 実経路` グループの直後)に追加:

```swift
  // MARK: - 自由文インテント(spec 2026-08-24)

  /// 聞き取り係。nil = 入口を出さない(非対応端末・従来テスト)。起動時に composition root が決める。
  @ObservationIgnored let intentParser: (any IntentParser)?
  /// 実行中のパース。入力が変わったら世代で無効化し、タスクも畳む。
  @ObservationIgnored var intentTask: Task<IntentOutcome, Never>?
  @ObservationIgnored var intentGeneration = 0
  @ObservationIgnored var intentPrewarmed = false
  /// 行の見た目(待機/読取中/失敗)。View が読むので observable のまま。
  public internal(set) var intentPhase: IntentPhase = .idle
```

`init` の引数列末尾(`routeProvider` の後)に `intentParser: (any IntentParser)? = nil` を追加し、本体で `self.intentParser = intentParser`。既存の `reset()`(`PlannerStore.swift` 内)の先頭に `intentQueryChanged()` を1行追加(旅のリセット・サンプル読み込みで読みかけを無効化する。`loadSample`/`loadRecent` が `reset()` を経由しない場合はそれらにも同じ1行)。

`PlannerStore+Intent.swift` を新規作成:

```swift
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
```

`AppCopy.swift`: struct 本体にフィールド4つを追加し、ja 表(963 行付近)と en 表(1201 行付近)の両方に値を足す:

| フィールド | ja | en |
|---|---|---|
| `intentRowTitle` | 旅の条件として読み取る | Read as trip details |
| `intentParsing` | 読み取っています | Reading |
| `intentFailed` | 読み取れませんでした。場所を選ぶか、書き方を変えてお試しください。 | Couldn't read that. Pick a place or try different wording. |
| `intentApplied` | 読み取りました。内容を確認して構築へ進んでください。 | Details filled in. Review them, then build. |

`AppCopyTests.swift`: 検査配列に4フィールドを足し、`#expect(checked == 460)` → `#expect(checked == 468)`、集計コメント末尾に `+ 4`(キー4×2ロケール=8検査)を追記。

- [ ] **Step 4: 通ることを確認** — `swift test --filter IntentFlowTests` と `--filter AppCopyTests` → PASS。
- [ ] **Step 5: 全体検証** — `apple/tools/verify-kit.sh` → 全スイート緑・警告ゼロ。
- [ ] **Step 6: コミット**。

---

### Task 6: アプリ — 検索窓の行・トースト描画・注入・UI テスト

**Files:**
- Modify: `apple/TripCheck/Screens/Start/PlaceSearchField.swift`
- Modify: `apple/TripCheck/Screens/Start/StartScreen.swift`
- Modify: `apple/TripCheck/App/TripCheckApp.swift`
- Modify: `apple/TripCheckUITests/PlannerFlowTests.swift`

**Interfaces:**
- Consumes: Task 5 の store API 一式、Task 4 の `IntentAvailability.makeDefaultParser(uiTesting:)`、既存 `ToastView(toast:)`(描画例は `PlanScreen.swift:69`: `if let toast = store.view.toast { ToastView(toast: toast).id(toast.id) }`)、`AppleSuggestions.query`
- Produces: a11y id `start.placeField`(TextField)と `start.intentRow`(行)。UI テストが使う。

- [ ] **Step 1: 失敗する UI テストを書く** — `PlannerFlowTests.swift` に追加(XCTest 様式。ASCII 入力は計画の裁定4、canned 値は Task 4 参照):

```swift
/// 文らしい入力に「読み取る」行が出て、canned の聞き取りがフォームに展開される。
/// 行き先は検索欄のプリフィルに、ウィッシュは行に、確認トーストが出る(spec §4.4)。
@MainActor
func testFreeTextIntentFillsTheStartForm() {
  let app = launch()
  let field = app.textFields["start.placeField"]
  XCTAssertTrue(field.waitForExistence(timeout: 10))
  field.tap()
  field.typeText("Weekend trip to Kanazawa, seafood and museum")

  let row = app.buttons["start.intentRow"]
  XCTAssertTrue(row.waitForExistence(timeout: 5))
  row.tap()

  XCTAssertTrue(app.otherElements["toast"].waitForExistence(timeout: 10))
  XCTAssertTrue(app.buttons["海鮮"].waitForExistence(timeout: 5))
  XCTAssertTrue(app.buttons["21世紀美術館"].exists)
  XCTAssertEqual(field.value as? String, "金沢")
}
```

(ウィッシュ行の名前ボタンが `app.buttons["海鮮"]` で引けない場合は、実際の要素階層に合わせて `staticTexts` 等へクエリを直してよい — 変更したらレポートに書く。)

- [ ] **Step 2: 落ちることを確認** — `apple/tools/verify-app.sh test` → 新テストが `start.placeField` 不在で FAIL(既存テストは緑のまま)。
- [ ] **Step 3: 実装** — 3ファイル:

**`PlaceSearchField.swift`**
1. TextField に `.accessibilityIdentifier("start.placeField")` を追加。
2. TextField の近くに `.onChange(of: suggestions.query) { store.intentQueryChanged() }` を追加(読みかけの無効化と失敗表示の消去。成功後のプリフィルでも発火するが、そのとき phase は idle・タスク無しなので無害)。
3. 候補リストのコンテナ条件を変える:現在の `if !suggestions.results.isEmpty { VStack(spacing: 0) { ForEach(...) } }` を `if store.intentRowVisible(for: suggestions.query) || !suggestions.results.isEmpty { VStack(spacing: 0) { /* 読み取る行 */ ForEach(...) } }` にし、`VStack` 先頭へ次の行を入れる(既存候補行と同じ余白・フォント・divider 様式に合わせる):

```swift
if store.intentRowVisible(for: suggestions.query) {
  Button {
    let text = suggestions.query
    Task {
      if let query = await store.readTripIntent(from: text) {
        suggestions.query = query
      }
    }
  } label: {
    HStack(spacing: 8) {
      if store.intentPhase == .reading {
        ProgressView().controlSize(.small)
      }
      VStack(alignment: .leading, spacing: 2) {
        Text(store.intentPhase == .reading ? app.intentParsing : app.intentRowTitle)
          .tcFont(.stopName)
          .foregroundStyle(Tokens.Color.ink)
        if store.intentPhase == .failed {
          Text(app.intentFailed)
            .tcFont(.meta)
            .foregroundStyle(Tokens.Color.muted)
        }
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .frame(minHeight: Tokens.Hit.primary)
    .contentShape(Rectangle())
  }
  .buttonStyle(.plain)
  .disabled(store.intentPhase == .reading)
  .accessibilityIdentifier("start.intentRow")
  .onAppear { store.prewarmIntentIfNeeded() }
  if !suggestions.results.isEmpty {
    Rectangle().fill(Tokens.Color.line).frame(height: 1)
  }
}
```

(`app` は既存の `AppCopy.for(store.request.locale)` 取得に合わせる。divider の形は既存行間の実装をそのまま流用する。)

**`StartScreen.swift`** — トースト描画を追加(計画の裁定1:既存の12件上限トーストの表示先が無い潜在バグの修正を兼ねる)。`PlanScreen.swift:69` の描画ブロックを読み、同じ `ToastView(toast:).id(toast.id)` を StartScreen のルートに同じ配置様式(overlay/セーフエリア調整)で移植する。下部 CTA(`.safeAreaInset(edge: .bottom)`)と重ならない位置にする。

**`TripCheckApp.swift`** — `PlannerStore` 生成の引数列(`routeProvider:` の後)に追加:

```swift
    intentParser: IntentAvailability.makeDefaultParser(uiTesting: isUITesting)
```

- [ ] **Step 4: 通ることを確認** — `apple/tools/verify-app.sh test` → 既存+新規テスト全緑(TEST SUCCEEDED)。
- [ ] **Step 5: kit 側も再確認** — `apple/tools/verify-kit.sh` → 緑。
- [ ] **Step 6: コミット**。

---

### Task 7: README・スクリーンショット・最終検証

**Files:**
- Modify: `apple/README.md`
- Create: スクリーンショット(`apple/tools/screenshot.sh` の既存の流儀に従い、保存先も既存スクリーンショットと同じ場所)

**Interfaces:**
- Consumes: 全タスクの成果物。

- [ ] **Step 1: 実測でテスト数を取る** — `apple/tools/verify-kit.sh` と `apple/tools/verify-app.sh test` を実行し、スイートごとの件数を**出力から**取る(計画の数字を写さない)。
- [ ] **Step 2: README 更新** — 機能一覧に「自由文インテント(Foundation Models)」の段落(端末内・iOS 26+Apple Intelligence 端末のみ入口表示・非対応端末は従来 UI)。検証表に行を追加し、**本物の LLM は自動テスト対象外**であること(ホスト状態依存)と、検証は開発機プローブ(spec §8)+手動確認である旨を正直に書く。テスト数は Step 1 の実測値。
- [ ] **Step 3: スクリーンショット** — シミュレータ(`-uiTesting`=Canned)で2枚:(a) 文を入れて「読み取る」行が出た状態、(b) 適用後のフォーム(ウィッシュ2件・4日・検索欄「金沢」・トースト)。撮れたら README の表から参照。ホストの Apple Intelligence が有効なら本物 FM でも1枚試み、撮れない場合はその旨を README に書く(捏造しない)。
- [ ] **Step 4: 最終検証** — `verify-kit.sh` / `verify-app.sh test` 両方緑・警告ゼロを確認。
- [ ] **Step 5: コミット**。
