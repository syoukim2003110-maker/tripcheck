# TripCheck WeatherKit 天気表示 設計仕様(2026-08-25)

対象: iOS アプリ(`apple/`)に**初めて**天気表示を足す。手段は Apple の WeatherKit。
web 版(`lib/` `app/`)は不変。前提 spec: `docs/superpowers/specs/2026-08-23-apple-capabilities-proposal.md` §3.6(案5 WeatherKit)。

## 1. 目的と立ち位置

web 版には Open-Meteo 由来の天気表示があるが、Swift 移植では Plan 2 が「天気・祝日」を範囲外にしたため、
**iOS アプリには今、天気機能が 1 つも無い**(`import WeatherKit` ゼロ、天気の型・画面も無し)。
この spec は iOS に天気を初導入する。置き換えではなく追加。

- 手段は **WeatherKit**(端末から直接呼ぶ。Secure Enclave/JWT は框架が扱うので、先の Worker 認証とは無関係)。
- **表示専用**。web と同じく「enrichment であって、決して門(feasibility gate)にしない」。
  `FeasibilityResult`/`PlannerContext` に警告コードや屋外ペナルティを足さない(Swift 限定分岐は DOM 同一性検証で
  捕まえられないため)。天気は `verified` を持たず CriticalFact にもしない。
- 差別化の一貫性: 天気は「生成」でも「判定」でもなく、**Apple Weather に帰属した表示**にとどめる。

ユーザー決定(2026-08-25): ①スコープ=表示専用(web 相当)②帰属=日ヘッダーに小バッジ
③WeatherKit 非対応時=黙って空(チップ無し)。

## 2. スコープ / 非スコープ

**スコープ:**
- AppCore に天気プロバイダのシーム(型・プロトコル・Apple 実装・canned・可用性)を新設
- `PlannerStore` にプラン構築後の非同期天気取得(世代ガード付き、非ブロッキング)
- PlanScreen の各日タブに天気チップ(アイコン+最高/最低℃+降水%)と日ヘッダーの Apple Weather 帰属バッジ
- WeatherKit entitlement/capability の配線、AppCopy への文言追加、テスト、手順書

**非スコープ(将来 or 別系統):**
- **Kit(TripCheckKit)への変更**(天気はエンジンに入らないので Kit は 1 行も触らない。
  CoreLocation/WeatherKit を Kit に持ち込まない既存の ImportBoundary 規則にも従う)
- feasibility/plan-builder への天気反映(明示的に禁止)
- 祝日(capabilities 提案では天気と同案だが、本 spec は天気のみ)
- web の Open-Meteo 変更、iOS からの Open-Meteo フォールバック(WeatherKit 一本)
- 時別予報・風・湿度(日別のみ、web と同じ 3 値に絞る)

## 3. アーキテクチャ(なぜ AppCore に切るか)

実経路(`RouteProvider`)・場所解決(`PlaceResolver`)・インテント(`IntentParser`)は
**プロトコルを Kit** に置く —— エンジンがそれらを消費するから。天気は**エンジンに一切入らない
表示専用**なので、他と違い **型もプロトコルも AppCore に置き、Kit は不可侵**にする。これが意図的な差分。

```
[iOS app: PlanScreen 日タブ]  ── 天気チップ + Apple Weather バッジ
        ▲ weatherByDay / weatherAttribution
[PlannerStore (AppCore)]  ── 構築後に非同期取得・世代ガード・失敗は空
        ▲ any WeatherProviding                (注入は composition root のみ)
[AppCore Weather/]
  WeatherDay(値型) / WeatherProviding(protocol)
  AppleWeatherProvider(@available iOS16, WeatherKit)  ← 実物
  CannedWeatherProvider                                ← テスト/UI
  WeatherAvailability.makeDefaultProvider(uiTesting:)  ← 可用性はここだけ
[TripCheckKit] ── 不変(天気シンボルゼロ)
```

既存の `IntentAvailability` / `WorkerAvailability` と同型。ストアは「注入されているか」だけ見る。

## 4. 型(AppCore、web の `TripWeatherDay` を踏襲)

```swift
public enum WeatherKind: String, Sendable, Codable, CaseIterable {
  case clear, partly, cloudy, fog, rain, snow, storm
}

public struct WeatherDay: Equatable, Sendable {
  public let index: Int          // プランの日 index(応答の貼り戻し用)
  public let date: CalendarDate  // Kit の CalendarDate を再利用
  public let kind: WeatherKind
  public let temperatureMaxC: Int
  public let temperatureMinC: Int
  public let precipitationPercent: Int?   // 欠損は nil
}

public struct WeatherAttribution: Equatable, Sendable {
  public let markLightURL: URL   // WeatherService.attribution.combinedMarkLightURL
  public let markDarkURL: URL    //                          .combinedMarkDarkURL
  public let legalPageURL: URL   //                          .legalPageURL
}

public struct WeatherResult: Equatable, Sendable {
  public let provider: String    // 常に "apple_weather"
  public let days: [WeatherDay]
  public let attribution: WeatherAttribution?
}

public struct WeatherDayRequest: Equatable, Sendable {
  public let index: Int
  public let date: CalendarDate
  public let coordinate: GeoPoint  // その日の停留所座標の平均(2桁丸め)
}

public protocol WeatherProviding: Sendable {
  func weather(for requests: [WeatherDayRequest], locale: PlannerLocale) async -> WeatherResult
}
```

web の `TripWeatherDay` との差: web が持つ WMO `code`(int)は Apple が返さないので**落とす**
(Apple は `WeatherCondition` を返し、それを `kind` に畳む)。3 値(kind/温度/降水%)は同一。
provider literal は `apple_weather`。

## 5. WeatherKit 呼び出しと変換(`AppleWeatherProvider`)

- `@available(iOS 16.0, *)`。座標ごとに `try await WeatherService.shared.weather(for: CLLocation, including: .daily)`
  → `Forecast<DayWeather>`。`GeoPoint → CLLocationCoordinate2D` は既存ブリッジ(`GeoPoint+MapKit.swift`)。
- 要求は日別。各 `WeatherDayRequest` の座標で日次予報を引き、`request.date` に一致する `DayWeather` を選ぶ。
  一致日が予報に無ければその日はスキップ(黙って落とす=空)。
- `DayWeather` → `WeatherDay`:
  - `date` = request.date、`index` = request.index
  - `temperatureMaxC` = `highTemperature.converted(to: .celsius).value` を四捨五入 Int、同様に `lowTemperature` → min
  - `precipitationPercent` = `(precipitationChance * 100)` 四捨五入 Int(0..100)
  - `kind` = 下表で `condition` を 7 種に畳む
- 帰属: `try await WeatherService.shared.attribution` から `combinedMarkLightURL`/`combinedMarkDarkURL`/`legalPageURL`
  を取り `WeatherAttribution` に。取得できなければ `attribution = nil`(その場合はチップも出さない=帰属無しで
  天気を見せない、Apple 要件)。
- 全体を `withThrowingTaskGroup` で並列に引き、投げたら**その座標だけ捨てる**(1 日の失敗が全体を落とさない)。
  ネットワーク不能/スロットル/権限なし → 空 `WeatherResult(days: [], attribution: nil)`。ログに座標・結果を残さない。

### 5.1 `WeatherCondition` → `WeatherKind` 畳み込み(web の 7 種に合わせる)

| WeatherKind | WeatherCondition(代表) |
|---|---|
| clear  | `.clear`, `.mostlyClear`, `.hot` |
| partly | `.partlyCloudy` |
| cloudy | `.cloudy`, `.mostlyCloudy`, `.windy`, `.breezy`, `.blowingDust`, `.smoky` |
| fog    | `.foggy`, `.haze` |
| rain   | `.drizzle`, `.rain`, `.heavyRain`, `.sunShowers`, `.freezingDrizzle`, `.freezingRain` |
| snow   | `.snow`, `.heavySnow`, `.flurries`, `.sleet`, `.hail`, `.wintryMix`, `.blizzard`, `.blowingSnow`, `.frigid` |
| storm  | `.thunderstorms`, `.isolatedThunderstorms`, `.scatteredThunderstorms`, `.strongStorms`, `.tropicalStorm`, `.hurricane` |

`@unknown default` と表外の値は中立の `cloudy`(web の範囲外フォールバックと同じ)。この関数は
`AppleWeatherProvider` 内に閉じ、テストから直接叩けるよう internal に出す。

## 6. データフローと `PlannerStore`

- 追加状態(observable): `weatherByDay: [Int: WeatherDay]`、`weatherAttribution: WeatherAttribution?`、
  `@ObservationIgnored` の `weatherProvider: (any WeatherProviding)?`、世代トークン `weatherGeneration`。
- **プランが建った後**に `fetchWeatherIfNeeded()` を 1 回呼ぶ(web の `useTripEnrichments` 相当)。
  再構築・日付変更・reset で `weatherByDay` を空にし世代を上げる(route/intent と同じ規律)。
- リクエスト構築(web の `buildWeatherPayload` を写す):
  - プランの各日について、その日の**解決済み停留所**の座標(GeoPoint)を平均し、緯度経度を**小数2桁に丸める**
    (≒1km、地名・stop id は載せない = プライバシー境界)。停留所が無い日はスキップ。
  - **ホライズン**: 日付が確定していて、かつ WeatherKit の日次予報範囲(概ね今日〜+10日)に入る日だけ要求。
    日付未定・範囲外の日はスキップ。最大 10 日。
- 取得は `Task` で、await 後に世代トークンが変わっていたら結果を捨てる。失敗・空 → `weatherByDay` は空のまま。
- `init` に `weatherProvider: (any WeatherProviding)? = nil` を additive に追加。既定 nil。

## 7. UI(アプリ本体・PlanScreen 日タブ)

- **天気チップ**(その日のヘッダー付近): 自作 SVG アイコン + 「最高℃ / 最低℃」+ 「降水 N%」。
  アイコンは既存 `Icon` の 6 種で足りる: clear→`sun`, partly→`sun`, cloudy→`cloud`, fog→`fog`,
  rain→`rain`, snow→`snow`, storm→`storm`(新規アイコン不要)。降水% は欠損なら省略。
  その日の `weatherByDay[dayIndex]` が無ければチップ自体を出さない。
- **Apple Weather 帰属バッジ**: 日ヘッダーに小さく、SwiftUI 標準の `Link(destination: legalPageURL)`
  として置く(既存の外部リンクは全て `Link` を使い、`BeforeYouGoCard.swift` 等が先例)。
  **表示は「Apple Weather」テキスト + `.external` アイコン**を既定とする —— このアプリは全アイコンを
  自作ベクタで描き、**非同期リモート画像の前例が 1 つも無い**(`AsyncImage`/`URLSession` 使用ゼロ)。
  Apple が配信する combined mark ロゴ画像の描画は**任意の上乗せ**とし、必要なら最小の自己完結ロー
  ダー(URLSession→Image、失敗時はテキストへフォールバック)を後段で足せる形にしておく。いずれの
  形でも「商標表記 + 法的リンク」を満たす。**天気チップが 1 つでも出ている時は必ず表示**(Apple 必須)。
  帰属(`legalPageURL` を含む `WeatherAttribution`)が取れない時は**天気自体を出さない**(帰属無しで
  天気を見せない)。アクセシビリティ id `plan.weatherAttribution`、読み上げは「Apple Weather」。
  チップは `plan.weatherChip.<day>`。
- 文言は AppCore `AppCopy` に ja/en 追加: 降水ラベル(`降水 N%` / `N% rain`)、帰属の読み上げラベル
  (`Apple Weather の天気` / `Weather by Apple Weather`)。絵文字禁止、CopyBoundary の逃げ場は AppCopy のみ。
- **印刷(PrintSheet)は本 spec の非スコープ**。既存の Kit 側フッター文言「Weather by Open-Meteo」
  (`PlannerCopy` 267 キーの 1 つ)は**触らない** —— Kit 不可侵かつ印刷への天気反映は扱わない。
  天気チップと帰属バッジは **PlanScreen の日タブ(画面)にのみ**出す。印刷反映は将来課題。

## 8. capability / entitlement / plist

- `apple/TripCheck/Resources/TripCheck.entitlements` に追加:
  `com.apple.developer.weatherkit = true`(有料会員のプロビジョニング前提=所持済み)。
- `project.yml` は entitlements を既に配線済み(Worker 認証で追加)なので、キー追加のみで反映。
- Info.plist に追加要件は基本なし(位置情報の常時取得はしない —— 座標は既に解決済みの停留所由来で、
  端末 GPS 権限は要求しない)。

## 9. テスト戦略

- **AppCore unit**:
  - `WeatherCondition → WeatherKind` 畳み込み表(代表値と `@unknown default` → cloudy)
  - `PlannerStore` 天気状態: 構築後に取得 → `weatherByDay` が埋まる/世代ガードで古い応答破棄/
    プロバイダ失敗で空/ホライズン外・日付未定・停留所なしの日をスキップ/座標平均と2桁丸め/
    最大 10 日で打ち切り
  - Fake(`FakeWeatherProvider`、決定的)+ `CannedWeatherProvider`
- **apple UI テスト**: `-uiTesting` + Canned で、天気チップと帰属バッジの表示・降水%文言を assert。
- **半自動 E2E**(コントローラ): Simulator で実 WeatherKit を叩き(可用時)、チップとバッジが出ることを目視。
  実 WeatherKit と実機は自動テストに含めない(FM/実 attest と同じ方針)。
- **CopyBoundary / BannedTerms**: 新規 AppCopy 文言が走査を通ること。
- 手順書 `apple/docs/weatherkit-check.md`(entitlement 有効化・Simulator/実機での確認・帰属の見え方)。

## 10. エラーと既知の落とし穴

- WeatherKit 失敗/スロットル/オフライン/非対応(Simulator の一部・iOS15 以下)→ 空 → チップ無し・エラー無し。
- **ホライズンは日次〜10日**。出発が 10 日超先・日付未定の旅程は何も出せない(仕様通り、黙って空)。
- **帰属は必須**: 天気を見せるなら Apple Weather 帰属(テキスト商標「Apple Weather」+ `legalPageURL`
  への `Link`)を必ず出す。`WeatherAttribution`(= `legalPageURL`)が取れなければ天気自体を出さない。
  ロゴ画像を上乗せする場合、画像ロード失敗時はテキスト帰属にフォールバック(天気は隠さない —— 画像は
  best-effort、帰属テキスト+リンクが常に土台)。
- WeatherKit の日次予報は端末ローカル時刻基準。`request.date`(旅程の暦日 `CalendarDate`)との突合は、
  `DayWeather.date` を **注入した `TimeZone`(既定 `.current`、テストで固定)** の `Calendar` で暦日成分に落とし、
  `request.date` の (年,月,日) と一致する日を選ぶ。TimeZone のズレで 1 日ずれないよう、この正規化関数は
  `AppleWeatherProvider` に `TimeZone` を注入する形で持たせ、単体テストで固定 TZ を渡して検証する。
- ロゴ画像は CSP/自己完結の制約は無い(アプリ本体)。ただしロゴ URL の取得失敗時は帰属テキストで代替せず
  天気を出さない。

## 11. グローバル制約(全タスク共通)

- **TripCheckKit は 1 行も変えない**。AppCore は additive(既存 public API 変更禁止)。
- `PlannerCopy` 267 キー不変。fixtures バイト同一。Swift 6 strict concurrency・新規警告ゼロ。
- 日本語文リテラルは `AppCopy.swift` のみ(CopyBoundaryTests)。絵文字禁止・自作 SVG のみ。
- 天気を `verified`/CriticalFact/feasibility に絶対に入れない(表示専用)。
- 座標・天気結果・帰属 URL をログ/永続化に不要に残さない。web(`lib/` `app/` `tests/`)は不変。
- コミットは末尾に既定の 2 行トレーラ。`git push` はしない(ユーザーが行う)。
