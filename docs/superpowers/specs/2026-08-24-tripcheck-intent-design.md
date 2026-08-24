# TripCheck 自由文インテント(Foundation Models)設計

2026-08-24。対象ブランチ: `claude/architecture-v2` からの新ブランチ。実装は `apple/` 配下のみ。

## 1. 背景と差別化

チャット型生成 AI は「それらしい旅程の文章」を生成する。店名・移動時間・順序はモデルの
記憶からの生成物で、正しさの検証は読む側の仕事になる(実測プローブでもモデルは「9月に」
から 2024-09-01 という予定日を捏造した — §8)。

TripCheck の差別化は**生成しないこと**にある。

1. **すべての数字に出どころがある。** 移動は MKDirections の実測、場所は MapKit の実在
   検索、実行可能性は決定的な判定器。全行に根拠ラベルが付く。
2. **LLM には旅程へ書き込む経路が構造的に存在しない。** 本機能で LLM が触れるのは開始
   フォームの4欄(場所・日数・時期・やりたいこと)だけで、必ず人の確認を通る。旅程内の
   時刻・経路・店は LLM の出力で一切変わらない。
3. **旅程は構造データ**なので、一箇所だけ直す・測り直す・再現することができる。

Foundation Models(iOS 26 の端末内 LLM)はこの構えの「聞き取りの上手い受付係」であり、
役割は**理解のみ**。自由文「9月に2泊で金沢。海鮮と21世紀美術館」を構造化された開始条件に
落とし、旅程を組むのは従来どおり決定的なプランナーである。端末内で完結するため API キー
不要・オフライン可・入力文は端末外に出ない。

## 2. スコープ / 非スコープ

**スコープ(v1)**
- 開始画面の検索窓に入力された「文らしい」テキストを、タップ操作を起点に端末内 LLM で
  解釈し、開始フォーム(検索欄プリフィル・ウィッシュリスト・日数・日付)に展開する。
- iOS 26 + Apple Intelligence 利用可能端末でのみ入口が現れる。それ以外は現状と同一画面。
- UI テストは決定的な `CannedIntentParser` 注入(実経路の `CannedRouteProvider` と同じ構え)。

**非スコープ(将来のための記録であり v1 では作らない)**
- 相対日付(「来週末」「GW」)の解決 — v1 では日付未定に落とす。
- フライト時刻の抽出、貼り付け取り込みシートへの統合、興味タグ→推薦の重み付け。
- 旅程の要約・ガイド文などの**文章生成は一切しない**(§1 の通り、恒久的な非スコープ)。
- 都市名によるウィッシュ解決の検索バイアス(国単位のバイアスは既存のまま)。

## 3. アーキテクチャ(ミラー型シーム — 実経路と同じ構え)

```
TripCheckKit (Foundation のみ)
  Intent/TripIntent.swift        … 型・プロトコル・結果 enum
  Intent/IntentTrigger.swift     … 「文らしさ」の決定的判定
  Intent/IntentResolution.swift  … 表記→日数/日付の決定的パーサ(展開は AppCore の Store 拡張)
TripCheckAppCore (FoundationModels 可)
  Intent/IntentAvailability.swift          … 入口を出すかの判定
  Intent/FoundationModelsIntentParser.swift … @available(iOS 26) の本物
  Intent/CannedIntentParser.swift          … 決定的な差し替え実装
  Store/PlannerStore+Intent.swift          … 状態と適用フロー
TripCheck (アプリ)
  Start/PlaceSearchField.swift ほか … 候補リスト先頭の「読み取る」行
  TripCheckApp.swift                … -uiTesting で Canned 注入
```

- Kit は Foundation のみの縛りを守る。`@Generable` マクロは FoundationModels 由来なので
  Kit に置けない。AppCore 内に `@Generable` のミラー型を定義し、Kit の `TripIntent` へ写す。
- 変更は追加のみ。既存 Kit 公開 API・`PlannerCopy`(267 キー)・fixtures は不変。

### 3.1 Kit の型(公開 API)

```swift
public struct TripIntent: Sendable, Equatable {
  public var destination: String   // 行き先の地名。本文の表記のまま。無ければ ""
  public var durationText: String  // 「2泊」「3日間」等、本文の表記のまま。無ければ ""
  public var whenText: String      // 「9月」「10月3日から」等、本文の表記のまま。無ければ ""
  public var wishes: [String]      // やりたいこと・行きたい場所。本文に書かれたものだけ
}

public enum IntentOutcome: Sendable, Equatable {
  case parsed(TripIntent)
  case failed                      // タイムアウト・モデルエラー・全欄空
}

public protocol IntentParser: Sendable {
  func parse(_ text: String, locale: PlannerLocale) async -> IntentOutcome
  func prewarm()                   // 既定実装は no-op
}
```

## 4. 動作仕様

### 4.1 入口 — 文らしさ判定と「読み取る」行

- 判定は決定的(LLM を使わない)。`IntentTrigger.looksLikeTripSentence(_:)`:
  - 前後空白を除去したうえで 4 文字未満 → false
  - 次のいずれかを含めば true: 「泊」「日間」「日帰り」「したい」「行きたい」「旅」「。」「、」
  - それ以外は、空白を含み 12 文字以上なら true(英語文の受け皿)
- 判定例(そのままテストケースにする):

  | 入力 | 判定 |
  |---|---|
  | 金沢 | false |
  | 9月に2泊で金沢に行きたい。海鮮と美術館めぐり | true |
  | 沖縄 ホテル | false |
  | 日帰りで鎌倉 | true |
  | Weekend trip to Kyoto, want temples and good coffee. | true |

- 判定が true **かつ** `IntentAvailability` が利用可のとき、場所候補リストの先頭に
  「旅の条件として読み取る」行を出す。行が初めて現れたとき `parser.prewarm()` を一度呼ぶ。
- LLM が動くのは行をタップしたときだけ。表示だけでは一切動かない。

### 4.2 パース — セッション規律(実測プローブで確定した掟)

- **パースごとに新品の `LanguageModelSession`**。セッションは履歴を保持し、使い回すと
  前回の答えが混入する(§8 実測)。
- **LLM は本文の表記を写すだけ**。暦・日数の計算は Swift の決定的コード(§4.3)。
  yyyy-MM-dd を直接出させると年・日を捏造する(§8 実測)。
- instructions(この文字列をそのまま使う):
  「旅行の希望を書いた文から条件を抜き出す。値は必ず本文に書かれた表記のまま写す。本文に無い情報は決して補わない。」
- `@Generable` ミラー型の `@Guide`(この文字列をそのまま使う):
  - destination: 「旅の行き先の地名。本文の表記のまま。無ければ空文字。」
  - durationText: 「泊数・日数の表現を本文の表記のまま。例:「2泊」「3日間」「2泊3日」。無ければ空文字。」
  - whenText: 「時期・日付の表現を本文の表記のまま。例:「9月」「10月3日から」「来週末」。無ければ空文字。」
  - wishes: 「やりたいこと・食べたいもの・行きたい場所の項目。本文に書かれたものだけ。」
- `GenerationOptions(temperature: 0.0)`。
- タイムアウト 20 秒(実経路と同じ番犬パターン)。超過・例外・キャンセルは `.failed`。
- 全欄が空(destination・wishes とも空)なら `.failed`(埋めるものが無い)。
- 実行中に入力テキストが変わる/画面を離れる → 進行中タスクをキャンセルし結果を捨てる。

### 4.3 決定的解決(Kit・純粋関数)

`IntentResolution` が表記を値へ落とす。LLM の出力に無いパターンは黙って nil に落とし、
決して推測で埋めない。数字は全角→半角を正規化してから判定する。

**日数** `days(fromDurationText:) -> Int?`

| 表記 | 結果 |
|---|---|
| N泊 | N+1 |
| N泊M日 | M |
| N日間 / N日 | N |
| 日帰り | 1 |
| 上記以外(Weekend 等) | nil |

結果は `EngineConstants.tripDaysRange`(1...14)にクランプする。

**日付** `startDate(fromWhenText:today:) -> String?`(today は "YYYY-MM-DD" で注入)

| 表記 | 結果 |
|---|---|
| M月D日 / M月D日から / M/D | today 以降の直近の該当日("YYYY-MM-DD")。年内で過ぎていれば翌年 |
| YYYY年M月D日 / YYYY-MM-DD | その日。ただし today より過去なら nil |
| M月(月のみ) | nil(日付未定の旅 — 日付が入れば公共交通の実測が動く実経路設計へ自然に接続) |
| 来週末・GW 等の相対表現 | nil(v1 非スコープ) |

### 4.4 フォーム展開(確認ファースト)

適用は `PlannerStore+Intent` が行う。**LLM の結果が直接プランになる経路は無い** — 全部
既存フォームの値になり、ユーザーが見て直してから構築ボタンを押す。

- **wishes** → 既存の追加経路(`addEntrySync` + `refreshInputMode`、貼り付け取り込みと同じ扱い)で
  ウィッシュリストへ(既存の場所解決・Resolve 画面がそのまま網になる)。`addEntry` は使わない —
  上限トーストが適用ループ中に連発するため。空白除去・大文字小文字/空白違いの重複はスキップ。
  上限は既存 `placeLimit`(12)から現在の件数を引いた分だけ。収まらない分は落とし、
  結果はフォーム上でそのまま見える。
- **destination** → 検索欄にテキストをプリフィルし候補を開く(自動追加はしない。アンカーに  するかはユーザーがタップで決める)。wishes が1件も無い場合も同じ(プリフィルのみ)。
- **durationText** → §4.3 の結果が非 nil なら日数(`days: Int?`)に設定。nil なら触らない。
- **whenText** → §4.3 の結果が非 nil なら日付(`String?`)に設定。nil なら触らない。
- 展開後、確認トースト(§5)を出す。実経路 T6 の規律を引き継ぎ、`canUndo` トーストが
  出ている間は譲る(Start 画面では実質発生しないが規約として同じガードを通す)。
- intent が持たない欄は決してクリアしない。

### 4.5 失敗と可用性

- `IntentAvailability`: `#available(iOS 26, *)` かつ `SystemLanguageModel.default.availability == .available`
  のときだけ利用可。`-uiTesting` 引数があるときは常に利用可(シミュレータのホスト状態に
  依存させない)。利用不可なら行が出ないだけで、他は今日と同一。
- `.failed` → 行の位置にインラインで一行(§5 `intentFailed`)。新しい入力で消える。
- 失敗はどこにもキャッシュしない。再タップすれば再実行。

## 5. コピー(AppCopy に追加。PlannerCopy は不変)

| キー | ja | en |
|---|---|---|
| intentRowTitle | 旅の条件として読み取る | Read as trip details |
| intentParsing | 読み取っています | Reading |
| intentFailed | 読み取れませんでした。場所を選ぶか、書き方を変えてお試しください。 | Couldn't read that. Pick a place or try different wording. |
| intentApplied | 読み取りました。内容を確認して構築へ進んでください。 | Details filled in. Review them, then build. |

絵文字なし。`AppCopyTests` のキー数カウントは追加後の実測値に更新する。

## 6. 保存・共有・プライバシー

- `TripIntent` は一時値。保存(persistence)にも共有リンクにも一切入らない(liveRoutes と
  同じ規律)。展開後のフォーム値は、手入力した場合と完全に同じ扱いで保存される。
- 処理は完全に端末内。外部送信はゼロ。統合仕様書 §13.2(外部送信一覧)への追記は**不要**
  (送信が無いため)— この判断自体を本節に記録する。

## 7. テスト戦略

- **Kit**: `IntentTriggerTests`(§4.1 の表+境界)、`IntentResolutionTests`(§4.3 の表+
  全角数字・年跨ぎ・過去日)。全部決定的。
- **AppCore**: `FakeIntentParser` 注入で `PlannerStore+Intent` の流れ(成功→展開・検索欄
  プリフィル・上限・重複スキップ/失敗→phase/入力変更→リセット/キャンセル)。
  `CannedIntentParserTests`(表の決定性)。可用性ゲート(-uiTesting 強制)。
- **UI テスト**: `-uiTesting` + Canned で1本 — 文を入力→行が出る→タップ→フォームに
  展開(ウィッシュ行・日数・確認トースト)→構築まで。
- **本物の FM は自動テストに入れない**(ホストの Apple Intelligence 状態に依存するため)。
  検証は開発機での実測プローブ(§8)と手動スクリーンショット。README の検証表に
  「実機/開発機でのみ再現可能」と正直に記載する。

## 8. 実測で確認済みの事実(2026-08-24、Xcode 26.6 / iOS SDK 26.5 / ホストで availability=available)

1. yyyy-MM-dd を直接生成させると「9月に」から `2024-09-01` を捏造(→ §4.2 の掟2)。
2. 「2泊3日なら3」と指示しても「2泊」に days: 2 を返した(→ 泊/日の換算は Swift 側)。
3. 表記のまま抽出方式では日本語2例・英語1例とも正確(「2泊」「9月」「10月3日から」
   「3日間」、wishes も本文どおり)。英語入力で destination が「京都」に正規化されたのは
   場所検索がそのまま受けられるため許容。
4. セッション再利用で単語入力「金沢」に前回の答えが混入(→ §4.2 の掟1: 毎回新品)。

## 9. グローバル制約(引き継ぎ)

- `lib/` `app/` `tests/`(web)不可侵。`apple/` のみ。
- TripCheckKit は Foundation のみ・変更は追加のみ。`PlannerCopy` 267 キー不変。fixtures バイト同一。
- Swift 6 strict concurrency、警告ゼロ。コピーに絵文字なし。
- API キーという概念自体が不要(端末内)。ログ・ドキュメントに個人入力文を残さない。
- コミットは既定のトレーラ2行で終える。`git push` はしない(ユーザーが行う)。
