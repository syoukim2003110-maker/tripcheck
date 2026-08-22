# TripCheck iOS アプリ(鍵ゼロ)実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TripCheckKit の上に SwiftUI の iPhone アプリを載せ、鍵ゼロ(サーバ・API キー・アカウントなし)で Start → Resolve → Build → Plan → Detail → 編集/Undo → 保存 → 共有/PDF までを動かす。

**Architecture:** `apple/Packages/TripCheckKit` に第 2 ターゲット **TripCheckAppCore**(`TripCheckKit` + `Observation` + `MapKit` に依存、UI なし)を足し、`PlannerStore`(状態 3 グループ・世代ガード付きビルド・ガード付き編集・Undo)と `ApplePlaceResolver`(MKLocalSearch)をそこに置いて `swift test` で検証する。`apple/TripCheck` は SwiftUI の薄い層(画面・部品・地図・デザイン)で、子ビューはイベント発火と UI 状態の Binding だけを持つ。XcodeGen の `project.yml` が唯一の正。

**Tech Stack:** Swift 6.3 / SwiftUI(iOS 17+)/ Observation / MapKit(`Map`, `Annotation`, `MapPolyline`, `MKLocalSearch`, `MKLocalSearchCompleter`)/ `ShareLink` / `ImageRenderer`(PDF)/ XcodeGen 2.46(`~/.local/xcodegen/bin/xcodegen`)/ Swift Testing(AppCore・App 単体)/ XCTest(UI テスト)/ `xcrun simctl`(iPhone 17 Pro シミュレータ)。

**Spec:** `docs/superpowers/specs/2026-08-21-tripcheck-swift-v1-design.md`(§4.3, §5, §6, §7)。**前提: Plan 1(`2026-08-21-tripcheck-kit-plan.md`)は完了済み(`4b07936`)。本計画の Interfaces は 2026-08-23 にその Kit に対して検証済みで、次の型がその名前で存在する:** `TripRequest`, `PlannerContext`, `TripBuilder`, `BuiltTripPlan`, `BuiltPlanDay`, `BuiltPlanLeg`, `FoodRecommendationSlot`, `InputMode`, `TripScenarios`, `TripFitAssessment`, `TripFitSearchOptions`, `TripCounterfactual`, `TripScenarioMetrics`, `ProvisionalTripLength`, `Feasibility`, `EvidenceSnapshotOptions`, `PlannerEvidenceSnapshot`, `CriticalFact`, `EvidenceStatus`, `FeasibilityResult`, `GapDetection`, `BuiltDayGapOptions`, `ItineraryGap`, `PlannerEditState`, `PlannerHistory`, `PlannerEdits`, `PlannerHardEditConflict`, `HardEditDecision`, `PlannerRemovedStop`, `ResolutionOverride`, `PlaceResolver`, `PlaceQuery`, `PlaceCandidate`, `PlaceResolution`, `ResolutionPipeline`, `CatalogResolver`, `ResolvedStop`, `RouteStop`, `StayEstimates`, `WishlistParser`, `WishlistSerializer`, `ParsedWishlistPlace`, `ParsedWishlistLine`, `WishlistPriority`, `WishlistTimeOfDay`, `ShareCodec`, `ShareScope`, `ShareScopeOptions`, `ScopedShareResult`, `ShareableTripInput`, `ShareWarningCode`, `TripStore`, `StoredTripRecord`, `SaveTripRecord`, `UserTripPayload`, `JSONValue`, `Copy`(→ `PlannerCopy`), `VerdictCopy`, `PrimaryWarning`, `WarningAction`, `TimelinePresentation`, `TimelineFillerKind`, `TripPresentation`, `WeekdayInfo`, `DayPalette`, `BannedTerms`, `Destinations`, `Destination`, `DestinationId`, `DestinationChoice`, `GeoBounds`, `GeoPoint`, `EntryAuthority`, `PassportRule`, `SwissSample`, `CalendarDate`, `IntKeyedDictionary`, `JSRegex`, `PlannerLocale`, `Pace`, `TravelPreference`, `FlightKind`, `MealPlan`, `MealKind`, `TransportMode`, `StopPriority`, `Confidence`, `ResolvedStopProvider`。**Kit に無いもの**(`PreTripTimeline`、`CalendarDate.adding(months:)`)は Task 10 で加法的に足す。

## Global Constraints

- iOS 17.0 以上、iPhone のみ(`TARGETED_DEVICE_FAMILY: "1"`)、縦向きのみ。Bundle ID `com.muraoshoki.tripcheck`、Team `T8L5BPC2XJ`、`CODE_SIGN_STYLE: Automatic`、`SWIFT_VERSION: "6.0"`、`SWIFT_STRICT_CONCURRENCY: complete`
- `project.yml` だけをコミット(`*.xcodeproj` は `apple/.gitignore:2` で無視済み。root の `.gitignore` には無い)。Task 1 で `apple/.gitignore` に `build/` を足す(xcodebuild の DerivedData を `apple/build` に置くため)。生成: `cd apple && ~/.local/xcodegen/bin/xcodegen generate`
- ビルド/テスト: `cd apple && xcodebuild -project TripCheck.xcodeproj -scheme TripCheck -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build build 2>&1 | tail -5`(`apple/tools/verify-app.sh` に集約)
- **Kit への変更は「小さく・加法的・パリティを壊さない」ものだけ**: Task 10 の `PreTripTimeline`(純関数)と `CalendarDate.adding(months:)`。`PlannerCopy` の鍵(TS 鍵一覧とのパリティテスト `keys.count == 267`)、ビルダー/判定/共有の挙動、既存テストには触らない。`lib/`・`app/`・`tests/`(TS)も触らない
- 子ビューは `@Environment(PlannerStore.self)` で読む。`view`(開閉・選択などの UI 状態)と `request` の単純フィールドは、`body` の先頭で `@Bindable var store = store` を宣言して Binding で直接書いてよい。`edit`/`bundle`/`history` と、再ビルドや解決を伴う変更は必ず `store.<action>()` 経由
- **`PlannerStore` に触るテストは全て `@Test @MainActor func … async`**(または `@MainActor struct … { }` の中)で書く。同期の `@Test func` で store を作らない(`PlannerStore` は `@MainActor`、パッケージは Swift 6 言語モードなので非分離からの参照はコンパイルエラー)。テストは必ず何かを表明する(`guard … else { return }` で黙って通る形にしない。ループが空のとき何も表明しないなら `#expect(checked > 0)` を置く)
- `PlannerViewState` は `TripCheckAppCore` にだけ存在し、`TripCheckKit` の関数には渡さない(型で不可能)
- 文言は `Copy.for(locale)`(Kit の `PlannerCopy`)/ `VerdictCopy` / `TimelinePresentation` / `TripPresentation` から取る。Kit に無いアプリ専用の文言(画面見出し・タブ名・確認文・アクセシビリティ用の短いラベル)は `AppCopy.for(locale)`(`Sources/TripCheckAppCore/Presentation/AppCopy.swift`、Task 2)に置く。**`PlannerCopy` には鍵を足さない。** ビューに日本語・英語の文リテラルを直書きしない。Task 14 の走査テストは `AppCopy.swift` と `Design/` だけを除外し、`AppCopy` の ja/en 表は `BannedTerms` を通す
- SF Symbols・絵文字は使わない。アイコンは `Design/Icons/` の 24 種(stroke 層 `IconShape` + fill 層 `IconFillShape`、`d` 属性は `SVGPath` で解釈)
- 色・タイポ・角丸は `Design/Tokens.swift` の定数のみ使う(`Color(hex:)` の直書き禁止。日の色は `Tokens.Day.color(index:)`、推薦枠は `Tokens.Color.recommendation`、`mark` アイコンの赤点は `Tokens.Color.markDot`)
- 本文 12pt 未満禁止(ラベル 11pt のみ許容)。`Font` は全て `Typography` 経由で `relativeTo:` 付き(Dynamic Type)
- `reduceMotion` でアニメーション停止。主要タップ標的 ≥44pt
- 「実測」は `BannedTerms` の禁止語。アプリ・テストのソースにも書かない(凡例は Kit の `legendMeasured`「実経路」)
- コミット規約は Plan 1 と同じ(散文体 + `Co-Authored-By` トレーラー)

---

## ファイル構成

```
apple/
├ .gitignore                                ← build/ を追加(Task 1)
├ project.yml
├ tools/verify-app.sh, tools/screenshot.sh
├ Packages/TripCheckKit/
│  ├ Package.swift                          ← TripCheckAppCore ターゲットと TripCheckAppCoreTests を追加
│  ├ Sources/TripCheckKit/Destinations/PreTripTimeline.swift   ← Kit への唯一の追加(Task 10、純関数)
│  ├ Tests/TripCheckKitTests/Units/PreTripTimelineTests.swift
│  ├ Sources/TripCheckAppCore/
│  │  ├ State/TripRequestState.swift, PlannerViewState.swift, WishlistEntry.swift   ← 構造化リスト(spec §5.2)と WishlistSerializer への変換
│  │  ├ Store/PlannerStore.swift, BuildRunner.swift, PlannerStore+Resolve.swift, PlannerStore+ViewModel.swift, PlannerStore+Edits.swift, PlannerStore+BeforeYouGo.swift, PlannerStore+Persistence.swift, PlannerStore+Share.swift
│  │  ├ Providers/ApplePlaceResolver.swift, AppleSuggestions.swift
│  │  ├ Presentation/AppCopy.swift          ← アプリ専用文言(Task 2)
│  │  ├ Map/MapModel.swift, GeoPoint+MapKit.swift
│  │  └ Model/BuiltPlanBundle.swift, Toast.swift, PlanIssue.swift, PersistedTrip.swift
│  └ Tests/TripCheckAppCoreTests/Support/Fakes.swift, FakeSearch.swift, …
├ TripCheck/
│  ├ App/TripCheckApp.swift, RootView.swift
│  ├ Design/Tokens.swift, Typography.swift, Icons/Icon.swift(+24 種), Icons/SVGPath.swift, Fonts/Anton-Regular.ttf, Fonts/OFL.txt
│  ├ Screens/Start/StartScreen.swift, PlaceSearchField.swift, WishlistRow.swift, EntryEditSheet.swift, PasteImportSheet.swift, DaysPicker.swift, RecentTripsSection.swift
│  ├ Screens/Resolve/ResolveScreen.swift, ResolveRow.swift, ManualPinSheet.swift, ConditionsSection.swift, FlightsSection.swift
│  ├ Screens/Build/BuildScreen.swift
│  ├ Screens/Plan/PlanScreen.swift, HeroHeader.swift, WarningLine.swift, DayTabs.swift, DayHeaderRow.swift, DayTimeBar.swift, SpareLine.swift, PlanToolbar.swift, TimelineList.swift, ActivityCard.swift, MovementCard.swift, MealRow.swift, HotelLegRow.swift, IssueCard.swift, VerdictDetails.swift, BeforeYouGoCard.swift, DaySettingsSheet.swift
│  ├ Screens/Detail/StopInspector.swift, EvidenceDisclosure.swift
│  ├ Screens/Share/ShareSheet.swift
│  ├ Screens/Print/TripPrintSheet.swift, PDFExporter.swift
│  ├ Map/TripMapView.swift, PinView.swift, MapLegend.swift
│  ├ Components/Toast.swift, DisclosureCard.swift, SegmentedPills.swift
│  └ Resources/Assets.xcassets, Info.plist
├ TripCheckTests/CopyBoundaryTests.swift, IconCoverageTests.swift   ← App の単体テスト(Task 14)
└ TripCheckUITests/PlannerFlowTests.swift
```

---

### Task 1: XcodeGen プロジェクト・デザイントークン・アイコン・空のアプリがシミュレータで起動する

**Files:**
- Create: `apple/project.yml`, `apple/TripCheck/App/TripCheckApp.swift`, `apple/TripCheck/App/RootView.swift`, `apple/TripCheck/Design/Tokens.swift`, `apple/TripCheck/Design/Typography.swift`, `apple/TripCheck/Design/Icons/Icon.swift`, `apple/TripCheck/Design/Icons/SVGPath.swift`, `apple/TripCheck/Resources/Info.plist`, `apple/TripCheck/Resources/Assets.xcassets/AppIcon.appiconset/Contents.json`(空のセット), `apple/tools/verify-app.sh`, `apple/tools/screenshot.sh`
- Modify: `apple/.gitignore`(`build/` を 1 行足す → `.build/ *.xcodeproj DerivedData/ xcuserdata/ .swiftpm/ build/`), `apple/Packages/TripCheckKit/Package.swift`
- Fonts: `apple/TripCheck/Design/Fonts/Anton-Regular.ttf` + `OFL.txt`。`node_modules/@fontsource/anton/files/` は woff/woff2 のみで、この Mac に fontTools/brotli/ttx は無い。ネットワークは通るので OFL の TTF を直接取る: `mkdir -p apple/TripCheck/Design/Fonts && curl -L -o apple/TripCheck/Design/Fonts/Anton-Regular.ttf https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf && curl -L -o apple/TripCheck/Design/Fonts/OFL.txt https://raw.githubusercontent.com/google/fonts/main/ofl/anton/OFL.txt`(OFL は同梱義務。README に sha256 を記録)。PostScript 名は `Anton-Regular`(確認済み)。取得できなければ `Typography.display` は `.system(.title, weight: .black)` にフォールバックし、README に記録

**Interfaces:**
- Produces: `Tokens.Color.{bg, panel, ink, ink2, muted, line, controlBorder, tile, tileDeep, accent, accentDeep, accentSoft, good, goodSoft, warnBg, warnBorder, warnInk, danger, focus, recommendation, markDot}`、`Tokens.Radius.{control = 10, card = 14, pill = 999}`、`Tokens.Day.color(index:) -> Color`(Kit の `DayPalette.color(forDayIndex:)`)、`Typography.{hero, screenTitle, stats, dayHeader, stopName, body, meta, label, display}`(`Font`)、`enum Icon: String, CaseIterable { arrow, bed, calendar, car, check, close, cloud, external, fog, fork, mark, moon, rain, pin, plus, search, signal, snow, spark, storm, sun, taxi, train, walk }`(`app/PlannerIcons.tsx:6-30` の 24 名と同順)、`IconShape: Shape`(stroke 層)、`IconFillShape: Shape`(fill 層)、`IconView(_ icon: Icon, size: CGFloat = 20, color: Color)`、`enum SVGPath { static func path(d: String, scale: CGFloat) -> Path }`

- [ ] **Step 1: project.yml と .gitignore**

```yaml
name: TripCheck
options:
  developmentLanguage: ja
  deploymentTarget:
    iOS: "17.0"
packages:
  TripCheckKit:
    path: Packages/TripCheckKit
settings:
  base:
    SWIFT_VERSION: "6.0"
    SWIFT_STRICT_CONCURRENCY: complete
    CODE_SIGN_STYLE: Automatic
    DEVELOPMENT_TEAM: "T8L5BPC2XJ"
    MARKETING_VERSION: "0.1.0"
    CURRENT_PROJECT_VERSION: "1"
targets:
  TripCheck:
    type: application
    platform: iOS
    sources: [TripCheck]
    dependencies:
      - package: TripCheckKit
        product: TripCheckKit
      - package: TripCheckKit
        product: TripCheckAppCore
    scheme:
      testTargets: [TripCheckUITests]        # Task 14 で TripCheckTests を先頭に足す
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: com.muraoshoki.tripcheck
        TARGETED_DEVICE_FAMILY: "1"
        ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon
        INFOPLIST_KEY_UIUserInterfaceStyle: Light
    info:
      path: TripCheck/Resources/Info.plist
      properties:
        CFBundleDisplayName: TripCheck
        CFBundleShortVersionString: $(MARKETING_VERSION)
        CFBundleVersion: $(CURRENT_PROJECT_VERSION)
        UILaunchScreen: {}
        UISupportedInterfaceOrientations: [UIInterfaceOrientationPortrait]
        UIAppFonts: [Anton-Regular.ttf]
        ITSAppUsesNonExemptEncryption: false
        CFBundleURLTypes:
          - CFBundleURLName: com.muraoshoki.tripcheck
            CFBundleURLSchemes: [tripcheck]
  TripCheckUITests:
    type: bundle.ui-testing
    platform: iOS
    sources: [TripCheckUITests]
    dependencies:
      - target: TripCheck
```

`apple/.gitignore` に `build/` を足す(`git check-ignore -v apple/build/Build/x` が `apple/.gitignore` を指すこと)。

- [ ] **Step 2: TripCheckAppCore ターゲットを Package.swift に追加**(中身は Task 2 で)

```swift
// Package.swift の targets に追加
.target(name: "TripCheckAppCore", dependencies: ["TripCheckKit"], swiftSettings: [.swiftLanguageMode(.v6)]),
.testTarget(name: "TripCheckAppCoreTests", dependencies: ["TripCheckAppCore"], swiftSettings: [.swiftLanguageMode(.v6)]),
// products に追加
.library(name: "TripCheckAppCore", targets: ["TripCheckAppCore"]),
```

`Sources/TripCheckAppCore/AppCore.swift` に `public enum TripCheckAppCore { public static let name = "AppCore" }`、`Tests/TripCheckAppCoreTests/SmokeTests.swift` に 1 テスト。注記: AppCore は `Sources/TripCheckAppCore` に置く(`Invariants/ImportBoundaryTests.swift` は `Sources/TripCheckKit` だけを走査するので、AppCore が MapKit/Observation を import し `PlannerViewState` を名乗っても引っかからない)。`platforms: [.iOS(.v17), .macOS(.v14)]` は Observation と MapKit の両方を満たすので、`swift test` は macOS ホストで AppCore のテストを走らせられる。**AppCore のテストは MapKit を実際に呼ばない**(`LocalSearching` / `SuggestionCompleting` のフェイクを注入)。`apple/tools/verify-kit.sh` はパッケージ全体を回すので、README のテスト本数は Task 14 で更新する。Swift 6 では `MKLocalSearchCompleterDelegate` のコールバックが MainActor 分離ではないため、アダプタは `@MainActor` にして `Task { @MainActor in … }` で渡す。

- [ ] **Step 3: Tokens / Typography / Icon**

```swift
// Design/Tokens.swift
import SwiftUI
import TripCheckKit

enum Tokens {
  enum Color {
    static let bg = SwiftUI.Color(hex: 0xF7F7F4), panel = SwiftUI.Color(hex: 0xFFFFFF)
    static let ink = SwiftUI.Color(hex: 0x171717), ink2 = SwiftUI.Color(hex: 0x3F3F3C), muted = SwiftUI.Color(hex: 0x616161)
    static let line = SwiftUI.Color(hex: 0xE3E3DE), controlBorder = SwiftUI.Color(hex: 0x85858E)
    static let tile = SwiftUI.Color(hex: 0xF0F0EC), tileDeep = SwiftUI.Color(hex: 0xE6E6E0)
    static let accent = SwiftUI.Color(hex: 0xD63F35), accentDeep = SwiftUI.Color(hex: 0xAE2E27), accentSoft = SwiftUI.Color(hex: 0xFBE9E6)
    static let good = SwiftUI.Color(hex: 0x157A46), goodSoft = SwiftUI.Color(hex: 0xE8F5EC)
    static let warnBg = SwiftUI.Color(hex: 0xFFF8E8), warnBorder = SwiftUI.Color(hex: 0xE9DFC2), warnInk = SwiftUI.Color(hex: 0x765700)
    static let danger = SwiftUI.Color(hex: 0xB42318), focus = SwiftUI.Color(hex: 0x2563EB)
    static let recommendation = SwiftUI.Color(hex: 0x7C3AED)   // 食事行の破線枠(Task 7)
    static let markDot = SwiftUI.Color(hex: 0xE2634E)          // mark アイコンの赤点(PlannerIcons.tsx:89)
  }
  enum Radius { static let control: CGFloat = 10, card: CGFloat = 14, pill: CGFloat = 999 }
  enum Day { static func color(index: Int) -> SwiftUI.Color { SwiftUI.Color(hexString: DayPalette.color(forDayIndex: index)) } }
  enum Hit { static let primary: CGFloat = 44, secondary: CGFloat = 24 }
}
extension Color {
  init(hex: UInt32) { self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255) }
  init(hexString: String) { self.init(hex: UInt32(hexString.dropFirst(), radix: 16) ?? 0) }
}
```

```swift
// Design/Typography.swift — spec §5.6 の表(≤840 列)。relativeTo で Dynamic Type
import SwiftUI
import UIKit

enum Typography {
  static let hero = Font.system(size: 24, weight: .black).leading(.tight)   // 900 相当
  static let screenTitle = Font.system(size: 32, weight: .heavy)
  static let stats = Font.system(size: 14, weight: .bold).monospacedDigit()
  static let dayHeader = Font.system(size: 14, weight: .heavy)
  static let stopName = Font.system(size: 16, weight: .bold)
  static let body = Font.system(size: 13, weight: .regular)
  static let meta = Font.system(size: 12.5, weight: .regular).monospacedDigit()
  static let label = Font.system(size: 11, weight: .heavy)
  static var display: Font { UIFont(name: "Anton-Regular", size: 28) != nil ? .custom("Anton-Regular", size: 28, relativeTo: .title) : .system(.title, weight: .black) }
}
```

`Font.system(size:weight:)` は固定サイズなので、実際には `Font.custom("", size:relativeTo:)` が使えない。**`@ScaledMetric` を使うビュー修飾子 `.tcFont(.stopName)`** を作り、`UIFontMetrics(forTextStyle:)` で拡縮する: `Typography.scaled(_ role: Role, in dynamicTypeSize: DynamicTypeSize) -> Font`。各ロールに `textStyle`(hero→`.title`、stopName→`.body`、meta→`.footnote`、label→`.caption2`)を対応させる。

```swift
// Design/Icons/Icon.swift — 24 種。app/PlannerIcons.tsx の SVG を 2 層の Shape に移す(24×24、stroke 1.8、round cap/join)
enum Icon: String, CaseIterable { case arrow, bed, calendar, car, check, close, cloud, external, fog, fork, mark, moon, rain, pin, plus, search, signal, snow, spark, storm, sun, taxi, train, walk }
struct IconView: View {
  let icon: Icon; var size: CGFloat = 20; var color: Color = Tokens.Color.ink
  var body: some View {
    ZStack {
      IconShape(icon: icon).stroke(color, style: StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
      IconFillShape(icon: icon).fill(icon == .mark ? Tokens.Color.markDot : color)
    }
    .frame(width: size, height: size).accessibilityHidden(true)
  }
}
/// stroke 層: <path d>・<rect rx>(addRoundedRect)・stroke の <circle>(addEllipse) の輪郭
struct IconShape: Shape {
  let icon: Icon
  func path(in rect: CGRect) -> Path {
    let s = rect.width / 24
    switch icon {
    case .check: return SVGPath.path(d: "M5 12.5 L10 17 L19 7", scale: s)
    case .close: return SVGPath.path(d: "M6 6 L18 18 M18 6 L6 18", scale: s)
    // 残り 22 種: PlannerIcons.tsx の d 属性をそのまま貼る。rect/circle は addRoundedRect / addEllipse(in:) を足す
    default: return Path()
    }
  }
}
/// fill 層: mark(:88, 赤点 :89)・signal(:114)・train(:151-152)・walk(:158)の `fill="currentColor" stroke="none"` の円だけ。他は空
struct IconFillShape: Shape {
  let icon: Icon
  func path(in rect: CGRect) -> Path { /* 4 種だけ addEllipse、他は Path() */ }
}
```

`Design/Icons/SVGPath.swift`: `d` 文字列を `Path` にする 80 行程度のパーサ。`M/m L/l H/h V/v C/c S/s A/a Z/z`(相対座標を含む)を扱い、`A` は rotation 0・等半径(円弧)だけ対応して中心を求め `addArc` にする(9 アイコン 12 弧が全部この形)。`S` は直前の制御点の鏡像。座標を手で写さず、Web の `d` をそのまま貼る。全部埋まったことは Task 14 の `everyIconHasAPath` で固定する(全 `Icon` の stroke 層が空でなく、mark/signal/train/walk の fill 層が空でない)。

- [ ] **Step 4: アプリ本体(空の画面)**

```swift
// App/TripCheckApp.swift
import SwiftUI
@main struct TripCheckApp: App {
  var body: some Scene { WindowGroup { RootView().preferredColorScheme(.light) } }
}
// App/RootView.swift
struct RootView: View { var body: some View { Text("TripCheck").font(Typography.display).foregroundStyle(Tokens.Color.ink).frame(maxWidth: .infinity, maxHeight: .infinity).background(Tokens.Color.bg) } }
```

- [ ] **Step 5: verify-app.sh / screenshot.sh**

```bash
#!/bin/zsh
# apple/tools/verify-app.sh — xcodegen → build (→ test)。DerivedData は apple/build(.gitignore 済み)
set -u; cd "$(dirname "$0")/.."
~/.local/xcodegen/bin/xcodegen generate > /dev/null || exit 1
DEST='platform=iOS Simulator,name=iPhone 17 Pro'
LOG=${TMPDIR:-/tmp}/tripcheck-app-build.log
ACTION=${1:-build}
xcodebuild -project TripCheck.xcodeproj -scheme TripCheck -destination "$DEST" -derivedDataPath build "$ACTION" > "$LOG" 2>&1; CODE=$?
grep -E "error:|warning: .*deprecated|BUILD|TEST" "$LOG" | tail -20; echo "exit=$CODE log=$LOG"; exit $CODE
```

```bash
#!/bin/zsh
# apple/tools/screenshot.sh <name> — 起動中のシミュレータをスクショ
set -u; OUT=${SCRATCHPAD:-/tmp}/tripcheck-$1.png
xcrun simctl io booted screenshot "$OUT" && echo "$OUT"
```

- [ ] **Step 6: ビルドして起動**

Run: `chmod +x apple/tools/*.sh && apple/tools/verify-app.sh && xcrun simctl install booted apple/build/Build/Products/Debug-iphonesimulator/TripCheck.app && xcrun simctl launch booted com.muraoshoki.tripcheck`
Expected: `BUILD SUCCEEDED`、シミュレータに「TripCheck」の文字。`apple/tools/screenshot.sh boot` で PNG を確認。`git status --porcelain apple/ | grep 'apple/build'` が空であること(build/ が無視されている)。

- [ ] **Step 7: Commit** — `git add apple/ && git commit -m "An empty TripCheck opens on the phone with its colours and icons ready"`

---

### Task 2: 状態 3 グループ・WishlistEntry・AppCopy・PlannerStore の骨格・世代ガード付きビルド

**Files:**
- Create: `Sources/TripCheckAppCore/State/{TripRequestState,PlannerViewState,WishlistEntry}.swift`, `Sources/TripCheckAppCore/Store/{PlannerStore,BuildRunner}.swift`, `Sources/TripCheckAppCore/Model/{BuiltPlanBundle,Toast}.swift`, `Sources/TripCheckAppCore/Presentation/AppCopy.swift`
- Test: `Tests/TripCheckAppCoreTests/{WishlistEntryTests,PlannerStoreBuildTests,AppCopyTests}.swift`

**Interfaces:**
- Produces:
```swift
public struct WishlistEntry: Identifiable, Hashable, Sendable {   // Codable ではない。保存は Task 11 の DTO 経由
  public var id: UUID; public var text: String; public var priority: WishlistPriority; public var fixedDay: Int?; public var fixedTime: String?; public var timeOfDay: WishlistTimeOfDay?; public var isReservation: Bool; public var stayMinutes: Int?
  public var pinned: PinnedResolution?
  public init(id: UUID = UUID(), text: String, priority: WishlistPriority = .normal, fixedDay: Int? = nil, fixedTime: String? = nil, timeOfDay: WishlistTimeOfDay? = nil, isReservation: Bool = false, stayMinutes: Int? = nil, pinned: PinnedResolution? = nil)
  public var parsed: ParsedWishlistPlace { ParsedWishlistPlace(name: text, day: fixedDay, time: fixedTime, timeOfDay: timeOfDay, isReservation: isReservation, priority: priority, stayMinutes: stayMinutes) }   // Kit の 7 ラベル init。既定引数は無い
}
public enum PinnedResolution: Hashable, Sendable {   // Kit の ResolvedStop(Hashable)を包む
  case apple(providerRef: String?, stop: ResolvedStop), manual(ResolvedStop), catalog(ResolvedStop)
  public var stop: ResolvedStop { get }
}
public enum WishlistSerialization {
  /// = WishlistSerializer.formatPlaces(entries.map(\.parsed), languageCode: locale)。Web と同じバイト(見出し `Day N`/`N日目`、区切り " — ")。headings 引数は持たない
  public static func raw(from entries: [WishlistEntry], locale: PlannerLocale) -> String
  /// WishlistParser.parse(raw) を畳む。`.heading` と日付きの `.place` は entry.fixedDay に写す。`mode` はビルダーと同じ規則(見出しが 1 つでもある、または place.day != nil が 1 つでもある → .existing_itinerary)
  public static func entries(fromPasted raw: String) -> (entries: [WishlistEntry], unparsed: [String], mode: InputMode)
}
public struct TripRequestState: Equatable, Sendable {   // Codable ではない(Task 11 の DTO 参照)
  entries: [WishlistEntry], unparsedLines: [String], inputMode: InputMode(表示用。正は bundle.plan.inputMode), tripDays: Int? (nil = 未定), tripStartDate: String?, destination: DestinationChoice, dayStartDefault: String, dayEndTarget: String?, maxWalkingMinutesPerLeg: Int?, maxTransfersPerLeg: Int?, arrivalAirport: String, arrivalTime: String, departureAirport: String, departureTime: String, flightKind: FlightKind, mealPlan: MealPlan, locale: PlannerLocale, resolutions: [UUID: PlaceResolution], mixedCountryCodes: [String], buildMode: automatic|custom
  public static func initial(locale: PlannerLocale) -> TripRequestState
  // pace / travelPreference / transferBufferMinutes / hotelQuery は持たない: 正は `edit`(PlannerEditState)だけ。Start/Resolve の条件 UI は `store.setPace(_:)` / `setTravelPreference(_:)` / `setTransferBufferMinutes(_:)` / `setHotelQuery(_:)`(ビルド前の単純 setter、Task 3 Produces)で `edit` を書く。二重に持つと tripRequest() が読む側と UI が書く側がずれる
}
public enum Screen: Equatable, Sendable { case start, resolve, building, plan, error(String) }
public struct Toast: Equatable, Sendable, Identifiable { public let id: UUID; public var text: String; public var kind: Kind; public var canUndo: Bool; public enum Kind: Equatable, Sendable { case limit, edit, info } }
public enum Inspector: Equatable, Sendable, Identifiable { case stop(String); case daySettings(Int); public var id: String { get } }
public enum PendingHardEdit: Equatable, Sendable {   // 閉包は持たない(PlannerViewState が Equatable/Sendable であるため)。適用処理は PlannerStore の `private var pendingApply: (@MainActor () async -> Void)?`
  case mustUnresolved(names: [String])
  case edit(conflicts: [PlannerHardEditConflict], extraConflicts: [String], fallbackTitle: String)
}
public struct PlannerViewState: Equatable, Sendable { screen: Screen, selectedDay: Int, mobileView: timeline|map, inspector: Inspector?, sheetDetent: peek|half|full, shareOpen: Bool, printOpen: Bool, pendingHardEdit: PendingHardEdit?, toast: Toast?, mapScope: MapScope(all|day), mapFocusedStopId: String?, verdictExpanded: Bool, pasteOpen: Bool, editingEntry: UUID?, announcement: String? }
public struct BuiltPlanBundle: Sendable { request: TripRequest, plan: BuiltTripPlan, fit: TripFitAssessment, evidence: PlannerEvidenceSnapshot, result: FeasibilityResult, counterfactuals: [TripCounterfactual], gaps: [Int: ItineraryGap], builtAt: Date }
public struct AppCopy: Sendable {   // Kit に無いアプリ専用文言。ja/en の 2 表。以降のタスクで要る鍵を随時足す(Task 14 の BannedTerms 走査で固定)
  public let startTitle, startHelpShort, pasteText, dateDisclosure, customDisclosure, timelineTab, mapTab, mapScopeAll, mapScopeDay: String
  public let diffLabels: [String]   // 結論の詳細の差分表(衝突/超過/移動/最小余白/訪問数/日数。Kit の Copy に無い)
  public func removeStopQuestion(name: String) -> String; public func mustRemovalNote(name: String) -> String; public func reservationRemovalNote(name: String) -> String; public func removedStopToast(name: String) -> String
  public static func `for`(_ locale: PlannerLocale) -> AppCopy
}
@Observable @MainActor public final class PlannerStore {
  public var request: TripRequestState; public var edit: PlannerEditState; public var view: PlannerViewState
  public private(set) var bundle: BuiltPlanBundle?
  public private(set) var history: PlannerHistory<PlannerEditState>   // = PlannerHistory(initial: .empty, limit: PlannerEdits.undoLimit)
  public init(resolvers: [any PlaceResolver], store: TripStore?, autosaveDebounce: Duration = .milliseconds(550), clock: any Clock<Duration> = ContinuousClock())
  public func tripRequest() -> TripRequest      // request + edit → TripRequest(view は見ない)。days は request.tripDays ?? edit.tripDays
  public func build() async                     // 世代ガード
  public func cancelBuild(); public func reset()   // reset は history = PlannerHistory(initial: .empty, limit: PlannerEdits.undoLimit) を再代入
  public func loadSample(_ id: DestinationId)
  public var buildGeneration: Int { get }
}
public enum BuildRunner { public static func run(_ request: TripRequest, options: TripFitSearchOptions = TripFitSearchOptions(), now: Date = Date()) -> BuiltPlanBundle }   // 純関数。Kit の検証済みパイプライン(Step 3)
```

- [ ] **Step 1: 失敗するテストを書く**

```swift
import Testing
@testable import TripCheckAppCore
import TripCheckKit

@Test func entriesSerialiseToWebCompatibleTextAndBack() {
  // 日付なしを先に置く(後ろに置くと `Day 2` 見出しの contextDay を継いで fixedDay == 2 になる —— WishlistParser.swift:221)
  let e = [WishlistEntry(text: "Ueno Park", priority: .optional),
           WishlistEntry(text: "Ghibli Museum", priority: .must, fixedDay: 2, fixedTime: "10:00", isReservation: true, stayMinutes: 120)]
  let raw = WishlistSerialization.raw(from: e, locale: .en)
  #expect(raw == "Ueno Park — optional\nDay 2\nGhibli Museum — 10:00 — booked — stay 120 min")   // WishlistSerializer.formatPlaces の形(booked と must は排他)
  let back = WishlistSerialization.entries(fromPasted: raw)
  #expect(back.entries.map(\.text) == ["Ueno Park", "Ghibli Museum"])
  #expect(back.entries[0].fixedDay == nil); #expect(back.entries[1].fixedDay == 2); #expect(back.entries[1].isReservation)
  #expect(back.mode == .existing_itinerary)   // 見出しがあるのでビルダーと同じく checker モード
}

@Test func plainListStaysInWishlistMode() {
  let r = WishlistSerialization.entries(fromPasted: "Ueno Park\nSenso-ji\nhttps://x.example\n")
  #expect(r.mode == .wishlist)
  #expect(r.entries.map(\.text) == ["Ueno Park", "Senso-ji"])
  #expect(r.unparsed == ["https://x.example"])   // URL だけの行は WishlistParser が .unparsed にする
}

@Test func pastedItineraryWithHeadingsBecomesCheckerMode() {
  let r = WishlistSerialization.entries(fromPasted: "Day 1\nUeno Park\nSenso-ji\nDay 2\nTokyo Tower\nhttps://x.example")
  #expect(r.mode == .existing_itinerary)
  #expect(r.entries.filter { $0.fixedDay == 1 }.map(\.text) == ["Ueno Park", "Senso-ji"])
  #expect(r.entries.filter { $0.fixedDay == 2 }.map(\.text) == ["Tokyo Tower"])
  #expect(r.unparsed == ["https://x.example"])
}

@Test @MainActor func tripRequestNeverReadsViewState() async {
  // コンパイル時の保証に加えて、view を変えても TripRequest が同一であること
  let store = PlannerStore(resolvers: [], store: nil)
  store.loadSample(.switzerland)
  let a = store.tripRequest()
  store.view.selectedDay = 3; store.view.mobileView = .map; store.view.verdictExpanded = true
  #expect(store.tripRequest() == a)
  #expect(a.days == 4)   // loadSample の request.tripDays が edit.tripDays(.empty の 3)に勝つ
}

@Test @MainActor func staleBuildsAreDropped() async {
  let store = PlannerStore(resolvers: [], store: nil)
  store.loadSample(.switzerland)
  async let first: Void = store.build()
  store.request.tripDays = 2          // 変更 → 世代が進む
  await store.build()
  await first
  #expect(store.bundle?.request.days == 2)
  #expect(store.edit.tripDays == 2)   // commit が edit.tripDays を追従させる
  #expect(store.view.screen == .plan)
}

@Test @MainActor func sampleBuildsWithZeroKeys() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland)
  await store.build()
  #expect(store.bundle?.plan.days.count == 4)
  #expect(store.bundle?.plan.days.allSatisfy { !$0.stops.isEmpty } == true)
  #expect(store.bundle?.result.alternatives.count == store.bundle?.counterfactuals.count)   // derive に counterfactuals を渡している
  #expect(store.view.screen == .plan)
}

@Test func appCopyPassesBannedTermsInBothLanguages() {
  for locale in [PlannerLocale.ja, .en] {
    let c = AppCopy.for(locale)
    for s in [c.startTitle, c.startHelpShort, c.pasteText, c.dateDisclosure, c.customDisclosure, c.timelineTab, c.mapTab, c.mapScopeAll, c.mapScopeDay] + c.diffLabels + [c.removeStopQuestion(name: "X"), c.mustRemovalNote(name: "X"), c.reservationRemovalNote(name: "X"), c.removedStopToast(name: "X")] {
      #expect(BannedTerms.violations(in: s).isEmpty, "\(locale): \(s)")
    }
  }
}
```

- [ ] **Step 2: 失敗を確認** — `cd apple/Packages/TripCheckKit && swift test --filter TripCheckAppCoreTests`

- [ ] **Step 3: 実装**

```swift
// Store/PlannerStore.swift(抜粋)
@Observable @MainActor public final class PlannerStore {
  public var request = TripRequestState.initial(locale: .ja)
  public var edit = PlannerEditState.empty
  public var view = PlannerViewState()
  public private(set) var bundle: BuiltPlanBundle?
  public private(set) var history = PlannerHistory<PlannerEditState>(initial: .empty, limit: PlannerEdits.undoLimit)   // init(initial:limit:) しか無い。10 は 1...20 の precondition を通る
  public private(set) var buildGeneration = 0
  let resolvers: [any PlaceResolver]; let store: TripStore?; let autosaveDebounce: Duration
  private var buildTask: Task<Void, Never>?

  public func tripRequest() -> TripRequest {
    let raw = WishlistSerialization.raw(from: request.entries, locale: request.locale)
    var ctx = PlannerContext()
    ctx.destination = request.destination; ctx.tripStartDate = request.tripStartDate
    ctx.resolvedStops = request.entries.compactMap { $0.pinned?.stop } + edit.resolvedStops
    ctx.resolvedBase = edit.resolvedBase; ctx.hotelQuery = edit.hotelQuery
    ctx.travelPreference = edit.travelPreference; ctx.transferBufferMinutes = edit.transferBufferMinutes
    ctx.durationOverrides = edit.userStayMinutes; ctx.lastEntryTimes = edit.lastEntryTimes
    ctx.dayStartTimes = edit.dayStartTimes; ctx.dayEndTimes = edit.dayEndTimes
    ctx.legModeOverrides = edit.legModeOverrides; ctx.dayOverrides = edit.dayOverrides
    ctx.lockedOrderByDay = edit.lockedOrderByDay; ctx.excludedStopIds = edit.removedStops.map(\.id)
    ctx.defaultDayStart = request.dayStartDefault; ctx.dayEndTarget = request.dayEndTarget
    ctx.maxWalkingMinutesPerLeg = request.maxWalkingMinutesPerLeg; ctx.maxTransfersPerLeg = request.maxTransfersPerLeg
    ctx.arrivalAirport = request.arrivalAirport.isEmpty ? nil : request.arrivalAirport; ctx.arrivalTime = request.arrivalTime.isEmpty ? nil : request.arrivalTime
    ctx.departureAirport = request.departureAirport.isEmpty ? nil : request.departureAirport; ctx.departureTime = request.departureTime.isEmpty ? nil : request.departureTime
    ctx.flightKind = request.flightKind; ctx.mealPlan = request.mealPlan
    return TripRequest(raw: raw, days: request.tripDays ?? edit.tripDays, pace: edit.pace, locale: request.locale, context: ctx)
  }

  public func build() async {
    buildTask?.cancel()
    buildGeneration += 1; let generation = buildGeneration
    view.screen = .building
    let req = tripRequest()
    let daysUndecided = request.tripDays == nil
    let task = Task.detached(priority: .userInitiated) { () -> BuiltPlanBundle in
      if daysUndecided {   // 日数未定: (日数, 拠点) の不動点。recommendBase の既定は baseRecommendations.first → provisionalBaseAsResolved
        let fixed = ProvisionalTripLength.resolve(request: req)
        var ctx = req.context; ctx.resolvedBase = fixed.base
        return BuildRunner.run(TripRequest(raw: req.raw, days: fixed.days, pace: req.pace, locale: req.locale, context: ctx))
      }
      return BuildRunner.run(req)
    }
    buildTask = Task { _ = await task.value }
    let result = await task.value
    guard generation == buildGeneration, !Task.isCancelled else { return }
    commit(result)
  }
  private func commit(_ b: BuiltPlanBundle) {
    bundle = b; edit.tripDays = b.request.days
    view.screen = b.plan.days.isEmpty ? .error("empty") : .plan
    view.selectedDay = min(view.selectedDay, max(0, b.plan.days.count - 1))
    view.announcement = VerdictCopy.hero(result: b.result, fit: b.fit, plan: b.plan, locale: request.locale)
  }
}
```

```swift
// Store/BuildRunner.swift — Kit の 4 段 + counterfactuals + gaps。順序に注意: derive の alternatives が FeasibilityResult.alternatives の唯一の供給元なので counterfactuals を先に計算する
public enum BuildRunner {
  public static func run(_ request: TripRequest, options: TripFitSearchOptions = TripFitSearchOptions(), now: Date = Date()) -> BuiltPlanBundle {
    let ctx = request.context
    let plan = TripBuilder.build(request)
    let fit = TripScenarios.assessTripFit(request, plan: plan, options: options)
    let evidence = Feasibility.snapshot(plan: plan, options: EvidenceSnapshotOptions(
      dateWasProvided: ctx.tripStartDate != nil, baseWasProvided: ctx.resolvedBase != nil, dayEndWasProvided: ctx.dayEndTarget != nil,
      userDurationStopIds: ctx.durationOverrides.map { Array($0.keys) }, capturedAt: Feasibility.nowISO8601(now),
      solverTimedOut: fit.solverTimedOut,   // 省くと COMPUTATION_LIMIT が出なくなる
      transferBufferMinutes: ctx.transferBufferMinutes, dayStartTimes: ctx.dayStartTimes, dayEndTimes: ctx.dayEndTimes))
    let counterfactuals = TripScenarios.counterfactuals(request, plan: plan, fit: fit, options: options)
    let result = Feasibility.derive(plan: plan, fit: fit, evidence: evidence, alternatives: counterfactuals)   // AlternativePlan == TripCounterfactual
    var gaps: [Int: ItineraryGap] = [:]
    for (i, day) in plan.days.enumerated() where i < fit.days.count {
      gaps[i] = GapDetection.primaryGap(GapDetection.detect(day: day, fitDay: fit.days[i], options: BuiltDayGapOptions(dayIndex: i, transferBufferMinutes: ctx.transferBufferMinutes)))
    }
    return BuiltPlanBundle(request: request, plan: plan, fit: fit, evidence: evidence, result: result, counterfactuals: counterfactuals, gaps: gaps, builtAt: now)
  }
}
```

`loadSample(_ id: DestinationId)`: `Destinations.byId(id).sample?[request.locale]`(無ければ `.en`)を `WishlistSerialization.entries(fromPasted:)` に通し、`SwissSample.resolvedStops(locale:)` を各 entry の `pinned = .catalog(stop)` に(名前一致)。`request.tripDays = 4`、`request.destination = .destination(.switzerland)`。`WishlistSerialization.entries(fromPasted:)` の `mode` は `WishlistParser.parse(raw).contains { if case .heading = $0 { return true }; if case .place(_, let ps) = $0 { return ps.contains { $0.day != nil } }; return false } ? .existing_itinerary : .wishlist`。`AppCopy` は ja/en の 2 つの `static let` 表と `for(_:)` だけ。

- [ ] **Step 4: 緑を確認** → **Step 5: Commit** — `git commit -m "The store holds the trip in three boxes and builds it without racing itself"`

---

### Task 3: Start 画面 — 場所リスト・検索フィールド(Apple 候補)・日数・国・CTA・サンプル

**Files:**
- Create: `Sources/TripCheckAppCore/Providers/AppleSuggestions.swift`, `apple/TripCheck/Screens/Start/{StartScreen,PlaceSearchField,WishlistRow,DaysPicker}.swift`, `apple/TripCheck/Components/{SegmentedPills,DisclosureCard}.swift`, `Tests/TripCheckAppCoreTests/Support/Fakes.swift`(`FakeResolver`, `FakeCompleter` —— 以降のタスクはこの 2 つを名前で使う)
- Modify: `apple/TripCheck/App/TripCheckApp.swift`(store を作って注入: `@State private var store = PlannerStore(resolvers: [CatalogResolver()], store: TripStore(directory: URL.applicationSupportDirectory.appendingPathComponent("TripCheck")))`、`RootView().environment(store)`。起動引数 `-uiTesting` なら `TripStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))`), `apple/TripCheck/App/RootView.swift`(`switch store.view.screen`。`.plan` は Task 6 まで `Text("plan")` のプレースホルダ)
- Test: `Tests/TripCheckAppCoreTests/{AppleSuggestionsTests,StartFlowTests}.swift`(デバウンス・キャッシュ・2 文字未満・12 件上限・CTA)

**Interfaces:**
- Produces: `@Observable @MainActor public final class AppleSuggestions { public var query: String; public private(set) var results: [PlaceSuggestion]; public private(set) var state: idle|loading|ready|unavailable; public init(debounce: Duration = .milliseconds(550), completer: any SuggestionCompleting = MKLocalSearchCompleterAdapter()); public func setRegion(_ bounds: GeoBounds?) }`、`PlaceSuggestion: Identifiable, Sendable { title, subtitle, token: CompletionToken }`(`CompletionToken` は `MKLocalSearchCompletion` を `@unchecked Sendable` で包む)、`public protocol SuggestionCompleting: Sendable { func complete(_ query: String, region: GeoBounds?) async throws -> [PlaceSuggestion] }`(テスト用フェイク可)、`PlannerStore.addEntry(text:, suggestion: PlaceSuggestion?) async`(候補を選んだ場合は `ApplePlaceResolver.resolve(completion:)` で `pinned = .apple`。Task 5 まではテキスト追加と同じ)、`PlannerStore.addEntrySync(text: String) -> UUID`(同期・候補なし。`addEntry` はこれを呼んでから解決する)、`PlannerStore.removeEntry(id:)`、`PlannerStore.setPriority(id: UUID, _ priority: WishlistPriority)`、`PlannerStore.setDestination(_ choice: DestinationChoice)`(`request.destination` と `request.mixedCountryCodes` を更新)、`PlannerStore.destinationBounds: GeoBounds?`(`Destinations.byId(id).bounds`。auto/worldwide は nil)、`PlannerStore.setPace(_: Pace)` / `setTravelPreference(_: TravelPreference)` / `setTransferBufferMinutes(_: Int)` / `setHotelQuery(_: String)`(ビルド前の条件。`edit` の該当フィールドを書くだけの同期 setter。ビルド後に同じ値を変えるのは Task 9 のガード付き編集)、`PlannerStore.canAddEntry: Bool`(<12)、`PlannerStore.startCTA: (label: String, enabled: Bool)`、`PlannerStore.requestBuildFromStart() async`(解決 → クリーンなら build、曖昧/未解決があれば `.resolve` へ)

- [ ] **Step 1: 失敗するテストと共有フェイクを書く**

```swift
// Tests/TripCheckAppCoreTests/Support/Fakes.swift
import TripCheckKit
@testable import TripCheckAppCore

/// 名前を挙げた問い合わせだけ review / unresolved にし、**挙げなかった名前は confirmed にする**。
/// ResolutionPipeline は答えの無い index を `.unresolved(reason: notFoundReason)` にし、`attentionRanks` は
/// review と unresolved を同じ列に数えるので、この契約でないと Task 5 の「4 件目を抑止」が 2 件抑止になる。
struct FakeResolver: PlaceResolver {
  var review: [String] = []
  var unresolved: [String] = []
  func resolve(_ queries: [PlaceQuery], destination: DestinationChoice, locale: PlannerLocale) async -> [Int: PlaceResolution] {
    var out: [Int: PlaceResolution] = [:]
    for q in queries {
      func stop(_ suffix: String, name: String) -> ResolvedStop {
        ResolvedStop(id: "fake-\(q.inputIndex)\(suffix)", name: name, area: "", latitude: 46.9 + Double(q.inputIndex) * 0.01, longitude: 7.4,
                     sourceUrl: "", verifiedAt: "", confidence: .medium, planningDurationMinutes: 60, isAnchor: true,
                     input: q.input, inputIndex: q.inputIndex, address: "", countryCode: "CH", provider: .apple)
      }
      if unresolved.contains(q.input) { out[q.inputIndex] = .unresolved(reason: ResolutionPipeline.notFoundReason) }
      else if review.contains(q.input) { out[q.inputIndex] = .review([PlaceCandidate(stop: stop("-a", name: "\(q.input) Old Town")), PlaceCandidate(stop: stop("-b", name: "\(q.input) Museum"))]) }
      else { out[q.inputIndex] = .confirmed(stop("", name: q.input)) }
    }
    return out
  }
}

@MainActor final class FakeCompleter: SuggestionCompleting {
  var calls = 0
  func complete(_ query: String, region: GeoBounds?) async throws -> [PlaceSuggestion] { calls += 1; return [] }
}
```

```swift
@Test @MainActor func suggestionsWaitForTwoCharsAndDebounce() async throws {
  let fake = FakeCompleter()
  let s = AppleSuggestions(debounce: .milliseconds(10), completer: fake)
  s.query = "S"; try await Task.sleep(for: .milliseconds(30)); #expect(fake.calls == 0)
  s.query = "Se"; try await Task.sleep(for: .milliseconds(30)); #expect(fake.calls == 1)
  s.query = "Sen"; s.query = "Sens"; try await Task.sleep(for: .milliseconds(30)); #expect(fake.calls == 2)   // 途中は潰れる
}

@Test @MainActor func thirteenthEntryIsRefused() async {
  let store = PlannerStore(resolvers: [], store: nil)
  for i in 0..<12 { await store.addEntry(text: "Place \(i)", suggestion: nil) }
  #expect(!store.canAddEntry)
  await store.addEntry(text: "Place 12", suggestion: nil)
  #expect(store.request.entries.count == 12)
  #expect(store.view.toast?.kind == .limit)
}

@Test @MainActor func startCtaNeedsPlacesAndGoesToResolveWhenAmbiguous() async {
  let store = PlannerStore(resolvers: [FakeResolver(review: ["Bern"])], store: nil)
  #expect(store.startCTA.enabled == false)
  await store.addEntry(text: "Bern", suggestion: nil); store.request.tripDays = 2
  #expect(store.startCTA.enabled)
  await store.requestBuildFromStart()
  #expect(store.view.screen == .resolve)
}
```

- [ ] **Step 2: 失敗を確認**

- [ ] **Step 3: 実装(AppCore)** — `AppleSuggestions`: `query` の `didSet` でタスクをキャンセルして再スケジュール(`Task.sleep(debounce)` → 2 文字未満なら `results = []`、それ以外 `completer.complete(query, region)`)。キャッシュ `(query, region)` → 結果、60 件 FIFO。`MKLocalSearchCompleterAdapter` は `MKLocalSearchCompleter` を `delegate` 経由で `CheckedContinuation` に橋渡し(`@MainActor`)。`requestBuildFromStart`: `ResolutionPipeline.resolve(queries, destination: request.destination, locale: request.locale, resolvers: resolvers)` を未固定の entry にだけ走らせ(`PlaceQuery(inputIndex:input:pinnedProviderRef:)`)、`review`/`unresolved` が 1 件でもあれば `view.screen = .resolve`、全部 `confirmed` かつ `mixedCountryCodes.isEmpty` なら `await build()`。

- [ ] **Step 4: 実装(UI)**

```swift
// Screens/Start/StartScreen.swift(抜粋)
struct StartScreen: View {
  @Environment(PlannerStore.self) private var store
  @State private var suggestions = AppleSuggestions()
  var body: some View {
    @Bindable var store = store
    let text = Copy.for(store.request.locale)      // Kit の PlannerCopy
    let app = AppCopy.for(store.request.locale)    // アプリ専用文言
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        Text(app.startTitle).font(Typography.screenTitle).foregroundStyle(Tokens.Color.ink)
        PlaceSearchField(suggestions: suggestions, onSubmit: { t, s in Task { await store.addEntry(text: t, suggestion: s) } })
          .disabled(!store.canAddEntry)
        Text(app.startHelpShort).font(Typography.body).foregroundStyle(Tokens.Color.muted)
        ForEach(store.request.entries) { entry in
          WishlistRow(entry: entry, locale: store.request.locale,
                      onPriority: { store.setPriority(id: entry.id, $0) },
                      onEdit: { store.view.editingEntry = entry.id },
                      onRemove: { store.removeEntry(id: entry.id) })
        }
        Button(app.pasteText) { store.view.pasteOpen = true }.buttonStyle(.secondaryPill)
        DaysPicker(days: $store.request.tripDays, locale: store.request.locale)
        DisclosureCard(title: app.dateDisclosure) { DatePickerRow(date: $store.request.tripStartDate, locale: store.request.locale) }
        DestinationPicker(choice: Binding(get: { store.request.destination }, set: { store.setDestination($0); suggestions.setRegion(store.destinationBounds) }), locale: store.request.locale)
        DisclosureCard(title: app.customDisclosure) { CustomOptions() }
        Button(text.sample) { store.loadSample(.switzerland); Task { await store.build() } }   // Kit の `sample`(「サンプルを見る」/"Try a sample")
          .buttonStyle(.secondaryPill).accessibilityIdentifier("start.seeExample")
        RecentTripsSection()
      }.padding(20)
    }
    .background(Tokens.Color.bg)
    .safeAreaInset(edge: .bottom) {
      Button { Task { await store.requestBuildFromStart() } } label: {
        Text(store.startCTA.label).font(Typography.stats).frame(maxWidth: .infinity).frame(height: Tokens.Hit.primary)
      }.buttonStyle(.primaryAccent).disabled(!store.startCTA.enabled).padding(16).background(.ultraThinMaterial)
    }
    .sheet(isPresented: $store.view.pasteOpen) { PasteImportSheet() }
    .sheet(item: editingEntryBinding) { EntryEditSheet(entryId: $0) }
  }
}
```

`PlaceSearchField`: `TextField` + 下に `results` を `List` 風に最大 5 件(各行 ≥44pt、`accessibilityLabel` = title + subtitle)。Return で候補なし追加。`WishlistRow`: 名前(`stopName`)・`check` アイコン(pinned)・`SegmentedPills`(通常/必須/任意)・チップ(日/時刻/予約/滞在)・スワイプ削除・タップで編集。`DaysPicker`: 3/4/5/未定のタイル + 「他の日数」`Picker`(1–14)。`DestinationPicker`: `Picker`(auto + 25 + worldwide、`Destinations.options(locale:)` が `(choice, label)` を返す)。

- [ ] **Step 5: ビルド・目視** — `apple/tools/verify-app.sh` → 起動 → `screenshot.sh start`。確認: CTA が初見で見える、12 件で追加が止まる、サンプルで Plan へ遷移(Plan 画面は Task 6 までプレースホルダ `Text("plan")`)。

- [ ] **Step 6: Commit** — `git commit -m "Travellers type places one at a time, and the phone finds them as they type"`

---

### Task 4: 行編集シートと貼り付け取込

**Files:**
- Create: `apple/TripCheck/Screens/Start/{EntryEditSheet,PasteImportSheet}.swift`
- Modify: `Sources/TripCheckAppCore/Store/PlannerStore.swift`(`updateEntry(id:, patch:)`, `importPasted(_:)`)
- Test: `Tests/TripCheckAppCoreTests/PasteImportTests.swift`

**Interfaces:**
- Produces: `PlannerStore.updateEntry(id: UUID, priority: WishlistPriority?, fixedTime: String??, isReservation: Bool?, stayMinutes: Int??, fixedDay: Int??)`、`PlannerStore.importPasted(_ raw: String) -> (added: Int, unparsed: Int)`(既存 entries に**追加**、12 件超は入れず `toast(.limit)`。見出し/日付きの行は `WishlistSerialization.entries(fromPasted:)` が `fixedDay` に写したものをそのまま足し、`request.inputMode` を表示用に更新する。**`edit.lockedOrderByDay` には書かない**: 停留所 id は解決後にしか存在せず、`TripBuilder` は `knownStopIds` に無い id を黙って落とし、非 nil の日は `parsedOrderByDay` を上書きするので、貼った順序がむしろ失われる。`fixedDay` があれば `WishlistSerialization.raw` が `Day N` 見出しを出し、ビルダー自身が `.existing_itinerary` を選ぶ。正は `bundle.plan.inputMode`)

- [ ] **Step 1: テスト**

```swift
@Test @MainActor func pasteAppendsUpToTwelveAndKeepsUnparsed() async {
  let store = PlannerStore(resolvers: [], store: nil)
  let r = store.importPasted((0..<14).map { "Place \($0)" }.joined(separator: "\n") + "\nhttps://x.example\n")
  #expect(r.added == 12); #expect(r.unparsed == 1); #expect(store.request.entries.count == 12)
  #expect(store.view.toast?.kind == .limit)
}

@Test @MainActor func pastedHeadingsLandInFixedDayNotInLockedOrder() async {
  let store = PlannerStore(resolvers: [], store: nil)
  _ = store.importPasted("Day 1\nUeno Park\nDay 2\nTokyo Tower")
  #expect(store.request.entries.map(\.fixedDay) == [1, 2])
  #expect(store.request.inputMode == .existing_itinerary)
  #expect(store.edit.lockedOrderByDay.values.isEmpty)
}

@Test @MainActor func entryPatchDistinguishesClearFromKeep() async {
  let store = PlannerStore(resolvers: [], store: nil)
  let id = store.addEntrySync(text: "Tokyo Tower")
  store.updateEntry(id: id, priority: nil, fixedTime: .some("14:30"), isReservation: nil, stayMinutes: nil, fixedDay: nil)
  #expect(store.request.entries[0].fixedTime == "14:30")
  store.updateEntry(id: id, priority: .optional, fixedTime: nil, isReservation: nil, stayMinutes: nil, fixedDay: nil)
  #expect(store.request.entries[0].fixedTime == "14:30"); #expect(store.request.entries[0].priority == .optional)
  store.updateEntry(id: id, priority: nil, fixedTime: .some(nil), isReservation: nil, stayMinutes: nil, fixedDay: nil)
  #expect(store.request.entries[0].fixedTime == nil)
}
```

- [ ] **Step 2: 失敗を確認** → **Step 3: 実装** — `EntryEditSheet`(`@Bindable var store = store` を body 先頭に): `DatePicker(.hourAndMinute)` を `ClockTime` 文字列に、`Toggle`「予約済み」、滞在 `Stepper`(15–480、15 刻み)/`Picker`、日 `Picker`(なし/1…tripDays)、「この場所を外す」は最後。ラベルは `Copy.for(locale)` に同義の鍵があればそれ、無ければ `AppCopy`。`PasteImportSheet`: `TextEditor` + 「読み取る」→ プレビュー(解析行 N / 読み取れない行 M)→ 「追加」。

- [ ] **Step 4: ビルド・目視** → **Step 5: Commit** — `git commit -m "A pasted note or an old itinerary turns into the same place list"`

---

### Task 5: ApplePlaceResolver と Resolve 画面(候補選択・3 件まで・手動ピン・条件・フライト)

**Files:**
- Create: `Sources/TripCheckAppCore/Providers/ApplePlaceResolver.swift`, `Sources/TripCheckAppCore/Store/PlannerStore+Resolve.swift`, `apple/TripCheck/Screens/Resolve/{ResolveScreen,ResolveRow,ManualPinSheet,ConditionsSection,FlightsSection}.swift`, `Tests/TripCheckAppCoreTests/Support/FakeSearch.swift`(`FakeSearch`, `HangingSearch`)
- Modify: `apple/TripCheck/App/TripCheckApp.swift`(resolvers を `[ApplePlaceResolver(), CatalogResolver()]` に。Apple を先頭に)
- Test: `Tests/TripCheckAppCoreTests/{ApplePlaceResolverTests,ResolveFlowTests}.swift`

**Interfaces:**
- Produces: `public struct ApplePlaceResolver: PlaceResolver { public init(search: any LocalSearching = MKLocalSearchAdapter(), timeout: Duration = .seconds(6), concurrency: Int = 4) }`、`public protocol LocalSearching: Sendable { func search(query: String, region: GeoBounds?, locale: PlannerLocale) async throws -> [LocalSearchHit] }`、`LocalSearchHit: Sendable { name, address: String?, latitude, longitude, countryCode: String?, category: String? }`(`category` は **Kit の Google 型文字列**: "museum", "park", "university" …)、`PlannerStore.chooseCandidate(entryId:, candidate: PlaceCandidate)`、`PlannerStore.rejectCandidates(entryId:)`、`PlannerStore.setManualPin(entryId:, name:, address:, latitude:, longitude:)`、`PlannerStore.retryResolve(entryId:) async`、`PlannerStore.continueFromResolve(force: Bool = false) async`(must/予約が未解決なら `view.pendingHardEdit = .mustUnresolved(names:)` で確認。`force` は確認ダイアログの「続ける」)、`PlannerStore.resolveRows: [ResolveRowModel]`(状態・候補 ≤3・順位・抑止フラグ)、`PlannerStore.canContinue: Bool`

- [ ] **Step 1: テストとフェイクを書く**

```swift
// Tests/TripCheckAppCoreTests/Support/FakeSearch.swift
struct FakeSearch: LocalSearching {
  var hits: [String: [LocalSearchHit]]
  func search(query: String, region: GeoBounds?, locale: PlannerLocale) async throws -> [LocalSearchHit] { hits[query] ?? [] }
}
struct HangingSearch: LocalSearching {
  func search(query: String, region: GeoBounds?, locale: PlannerLocale) async throws -> [LocalSearchHit] { try await Task.sleep(for: .seconds(60)); return [] }
}
```

```swift
@Test func appleHitsBecomeEstimatedCandidatesNeverVerified() async {
  // 入力と完全一致する名前を置かない(一致が 1 件なら ResolutionPipeline.autoAccept が confirmed にする)
  let fake = FakeSearch(hits: ["Bern": [.init(name: "Old Town of Bern", address: "Bern, Switzerland", latitude: 46.948, longitude: 7.447, countryCode: "CH", category: "tourist_attraction"),
                                        .init(name: "Bern Historical Museum", address: "Bern", latitude: 46.943, longitude: 7.449, countryCode: "CH", category: "museum")]])
  let r = await ApplePlaceResolver(search: fake).resolve([PlaceQuery(inputIndex: 0, input: "Bern", pinnedProviderRef: nil)], destination: .auto, locale: .en)
  guard case .review(let c)? = r[0] else { Issue.record("expected review (2 candidates)"); return }
  #expect(c.count == 2); #expect(c.allSatisfy { $0.stop.provider == .apple })
  #expect(c[0].stop.confidence == .medium)
  #expect(c.allSatisfy { $0.stop.verifiedAt.isEmpty && $0.stop.userProvidedCoordinates != true })
}

@Test func exactAppleMatchIsConfirmedDirectly() async {
  let fake = FakeSearch(hits: ["senso-ji": [.init(name: "Senso-ji", address: "Asakusa", latitude: 35.7148, longitude: 139.7967, countryCode: "JP", category: "place_of_worship")]])
  let r = await ApplePlaceResolver(search: fake).resolve([PlaceQuery(inputIndex: 0, input: "senso-ji", pinnedProviderRef: nil)], destination: .auto, locale: .en)
  guard case .confirmed(let s)? = r[0] else { Issue.record("expected confirmed"); return }
  #expect(s.countryCode == "JP")
}

@Test func singleUniversityHitGoesToReview() async {
  let fake = FakeSearch(hits: ["Bern": [.init(name: "Universität Bern", address: "Bern", latitude: 46.95, longitude: 7.44, countryCode: "CH", category: "university")]])
  let r = await ApplePlaceResolver(search: fake).resolve([PlaceQuery(inputIndex: 0, input: "Bern", pinnedProviderRef: nil)], destination: .auto, locale: .en)
  guard case .review(let c)? = r[0] else { Issue.record("non-touristic single hit must ask"); return }
  #expect(c.count == 1); #expect(c[0].isTouristic == false)   // ResolutionPipeline.isNonTouristic(name:category:)
}

@Test func timeoutYieldsUnresolvedNotCrash() async {
  let r = await ApplePlaceResolver(search: HangingSearch(), timeout: .milliseconds(20)).resolve([PlaceQuery(inputIndex: 0, input: "X", pinnedProviderRef: nil)], destination: .auto, locale: .en)
  guard case .unresolved? = r[0] else { Issue.record("expected unresolved"); return }
  #expect(r.count == 1)
}

@Test @MainActor func resolveRowsGateFourthAttentionItem() async {
  let store = PlannerStore(resolvers: [FakeResolver(review: ["A", "B", "C", "D"])], store: nil)   // E は confirmed(Fakes.swift の契約)
  for n in ["A", "B", "C", "D", "E"] { await store.addEntry(text: n, suggestion: nil) }
  store.request.tripDays = 2
  await store.requestBuildFromStart()
  let rows = store.resolveRows
  #expect(rows.filter { $0.state == .review }.count == 4)
  #expect(rows.filter { $0.suppressed }.count == 1)        // attentionRanks の rank 3 = D
  #expect(rows.allSatisfy { $0.candidates.count <= ResolutionPipeline.reviewShortlistLimit })
  #expect(!store.canContinue)
}

@Test @MainActor func manualPinIsUserProvidedAndUnblocks() async {
  let store = PlannerStore(resolvers: [FakeResolver(unresolved: ["Nowhere"])], store: nil)
  await store.addEntry(text: "Nowhere", suggestion: nil); store.request.tripDays = 1
  await store.requestBuildFromStart()
  store.setManualPin(entryId: store.request.entries[0].id, name: "Nowhere", address: "", latitude: 1, longitude: 2)
  #expect(store.request.entries[0].pinned?.stop.userProvidedCoordinates == true)
  #expect(store.canContinue)
}
```

- [ ] **Step 2: 失敗を確認**

- [ ] **Step 3: 実装(AppCore)** — `ApplePlaceResolver.resolve`: `withTaskGroup` で同時 4、各クエリを `withTimeout(timeout)`(`async let` + `Task.sleep` の競争)。ヒットを `PlaceCandidate(stop: ResolvedStop(id: "apple-\(inputIndex)-\(hash)", providerRef: nil, name: hit.name, area: address の市区, latitude:, longitude:, sourceUrl: "", verifiedAt: "", confidence: .medium, planningDurationMinutes: StayEstimates.estimateStayMinutes(name: hit.name, placeTypes: hit.category.map { [$0] }), isAnchor: true, placeTypes: hit.category.map { [$0] }, input: query.input, inputIndex: query.inputIndex, address: hit.address ?? "", countryCode: hit.countryCode, provider: .apple), category: hit.category)`(`isTouristic` は `PlaceCandidate.init` の既定が `ResolutionPipeline.isNonTouristic(name:category:)` と `placeTypes` から計算する)に変換 → 上位 3(`ResolutionPipeline.reviewShortlistLimit`)→ `ResolutionPipeline.autoAccept(input:candidates:)` が非 nil なら `.confirmed(stop)`、nil なら `.review(candidates)`。0 件 → `.unresolved(reason: ResolutionPipeline.notFoundReason)`、タイムアウト/例外 → `.unresolved(reason: "unavailable")`。`MKLocalSearchAdapter`: `MKLocalSearch.Request(naturalLanguageQuery:)`、`region = MKCoordinateRegion(bounds)`、`resultTypes = [.pointOfInterest, .address]`、`placemark.isoCountryCode`。**`pointOfInterestCategory` は rawValue("MKPOICategoryMuseum")をそのまま入れず、Kit の Google 型文字列に写す**(`.museum→"museum"`, `.park→"park"`, `.amusementPark→"amusement_park"`, `.zoo→"zoo"`, `.aquarium→"aquarium"`, `.restaurant→"restaurant"`, `.cafe→"cafe"`, `.university→"university"`, `.school→"school"`, `.hospital→"hospital"`, `.stadium→"stadium"`, `.beach→"beach"`, `.nationalPark→"national_park"`, `.theater→"performing_arts_theater"`, `.store→"department_store"`, 他は nil)。これで `StayEstimates.typeDurations` と `ResolutionPipeline.nonTouristicCategories` の両方に当たる。`PlannerStore+Resolve`: `request.resolutions[entryId]` の更新、`resolveRows` は `ResolutionPipeline.attentionRanks` で順位付けし rank ≥3 を `suppressed`、`request.mixedCountryCodes` を `ResolutionPipeline.mixedCountryCodes(pinned stops)` から。

- [ ] **Step 4: 実装(UI)** — `ResolveScreen`(`@Bindable var store = store`): 見出し(全確認時「N か所を確認しました」は `Copy` の既存鍵、無ければ `AppCopy`)、混在国の警告を**上**に(国 `Picker` + worldwide ボタン)、`ResolveRow`(状態アイコン `check/mark/search/close`、候補(最大 3 = `ResolutionPipeline.reviewShortlistLimit`)を `Button` で、「候補にない(住所で指定)」→ `ManualPinSheet`、抑止文、未発見の 3 ボタン、行の「外す」。**4 件目以降の `Picker` は作らない**: パイプラインが結果側で 3 件に切るので表示側に 4 件目は来ない)、`ManualPinSheet`(住所 `TextField` + 小さな `Map` をタップで座標 + 緯度経度 `TextField(inputMode: .decimal)` + 「この地点を使う」)、`ConditionsSection`(日数・日付・ホテル・ペース・移動・一日の開始/終了・乗換バッファ・徒歩上限・乗換上限)、`FlightsSection`(空港 `Picker` は `TripPresentation.airportOptionsFor(locale:destination:)`、国未確定なら全空港、時刻、便種別、`AirportComparisonView`)、下部 CTA「N か所で続ける」。`pendingHardEdit == .mustUnresolved` は `.alert` で「続ける」→ `continueFromResolve(force: true)`。

- [ ] **Step 5: ビルド・目視**(シミュレータは Apple 検索が実際に動く。「ベルン」「Bern」「Nowhere xyz123」で 3 状態を確認) → **Step 6: Commit** — `git commit -m "Ambiguous places get a choice, lost places get a pin, and nothing pretends to be verified"`

---
### Task 6: Build 画面と Plan 画面の骨格(ヒーロー・警告 1 件・日タブ・日ヘッダー・時間バー・統計行)

**Files:**
- Create: `apple/TripCheck/Screens/Build/BuildScreen.swift`, `apple/TripCheck/Screens/Plan/{PlanScreen,HeroHeader,WarningLine,DayTabs,DayHeaderRow,DayTimeBar,SpareLine,PlanToolbar}.swift`, プレースホルダ(`struct X: View { var body: some View { EmptyView() } }`)として `apple/TripCheck/Screens/Plan/{TimelineList,IssueCard,VerdictDetails,BeforeYouGoCard}.swift` と `apple/TripCheck/Map/TripMapView.swift`(Task 7/8/10 が置換する), `Sources/TripCheckAppCore/Model/PlanIssue.swift`, `Sources/TripCheckAppCore/Store/PlannerStore+ViewModel.swift`
- Modify: `apple/TripCheck/App/RootView.swift`(`.building` → `BuildScreen`、`.plan` → `PlanScreen`、`.error(msg)` 分岐)
- Test: `Tests/TripCheckAppCoreTests/PlanViewModelTests.swift`

**Interfaces:**
- Produces(AppCore、導出値は全部ここ。ビューは計算しない):
  `PlannerStore.hero: (text: String, icon: String)`(`Icon` の rawValue)、`public enum PlanWarningAction: Equatable, Sendable { case fixInput, chooseCountry, chooseCandidate, openAlternatives, openStop(String), removeOptional, retryBuild }`(Kit の `WarningAction` とは別名。写像: `.seeAlternatives → .openAlternatives`, `.seeWhatToRemove → .removeOptional`, `.reviewConditions → .openStop(id)`(特定の停留所が分かるとき)/ `.fixInput`)、`PlannerStore.primaryWarning: (text: String, action: PlanWarningAction?)?`、`PlannerStore.statsLine: String`(`TripPresentation.tripStatsLine(TripPresentation.tripStatsTotals(plan:fit:), locale:)`)、`PlannerStore.dayTabs: [DayTabModel { index: Int, label: String, colorHex: String, density: String, isWeekend: Bool }]`(`label = TimelinePresentation.dayTabTitle(index:locale:)`、`density = TimelinePresentation.dayTabDensityLabel(stopCount:locale:)`、`colorHex = DayPalette.color(forDayIndex:)`、`isWeekend = TripPresentation.weekdayInfo(day.date, locale:)?.isWeekend ?? false`。**祝日は出さない**: 鍵ゼロのアプリに祝日データ源が無い。`holidayBadge` は使わない)、`PlannerStore.dayHeader(index) -> (summary: String, bar: DayTimeBarModel { visit, travel, slack: Double(割合), markers: [Marker(kind: reservation|conflict, position)], a11y: String })`(`summary = TimelinePresentation.dayHeaderSummary(day:fit:locale:)`)、`PlannerStore.issues: [PlanIssue { kind, text, action: PlanWarningAction? }]`、`PlannerStore.spareCapacityLine(day) -> String?`(`TimelinePresentation.spareCapacityLine(slackMinutes:remaining:locale:)`)、`PlannerStore.selectDay(_:)`

- [ ] **Step 1: テスト**

```swift
@Test @MainActor func dayTimeBarSumsToOne() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  #expect(store.dayTabs.count == 4)
  for i in 0..<4 { let b = store.dayHeader(i).bar; #expect(abs(b.visit + b.travel + b.slack - 1) < 1e-9) }
}

@Test @MainActor func heroAndWarningPassBannedTerms() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  #expect(BannedTerms.violations(in: store.hero.text).isEmpty)
  #expect(["check", "signal", "spark", "close", "search"].contains(store.hero.icon))   // Icon は App 側の型。AppCore では rawValue 文字列だけを見る
  if let w = store.primaryWarning { #expect(BannedTerms.violations(in: w.text).isEmpty) }
  #expect(store.statsLine.contains("8"))
}

@Test @MainActor func onlyOneWarningAndItNamesTheTarget() async {
  let store = PlannerStore(resolvers: [FakeResolver(unresolved: ["Nowhere"])], store: nil)
  store.loadSample(.switzerland); await store.addEntry(text: "Nowhere", suggestion: nil)
  await store.requestBuildFromStart(); await store.continueFromResolve(force: true)
  #expect(store.primaryWarning?.text.contains("Nowhere") == true)
  #expect(store.primaryWarning?.action == .fixInput)
}
```

- [ ] **Step 2: 失敗を確認** → **Step 3: 実装(AppCore)** — `hero` は `VerdictCopy.hero(result:fit:plan:locale:)` + 状態→アイコン(`VERIFIED→"check" / PROVISIONAL→"signal" / FEASIBLE_IF_ASSUMPTIONS→"spark" / INFEASIBLE→"close" / UNKNOWN→"search"`)。`primaryWarning` は **1 件だけ**、AppCore が鍵ゼロの前段を自分で出す: 未解決入力(`plan.unknownEntries` / `result.unresolvedPlaceNames` → `.fixInput`)> 国の衝突(`request.mixedCountryCodes` → `.chooseCountry`)> 曖昧(`request.resolutions` に `.review` → `.chooseCandidate`)。どれも無ければ `VerdictCopy.primaryWarning(result: r, deferredAnchorStops: (plan.deferredUnavailableStops + plan.deferredOptionalStops).filter(\.isAnchor), locale: l)` を呼び、戻りの `text` が nil のとき `r.state == .UNKNOWN && r.unknownCause == .COMPUTATION_LIMIT` なら `VerdictCopy.minimumDaysCopy(r, locale: l)` を text にし、それ以外は警告なし(nil)。`action` は上の写像で `PlanWarningAction?` に。ボタンのラベルは Kit 由来なら `WarningAction.label(locale)`、アプリ由来なら `AppCopy`。`dayHeader(i).bar` は `fit.days[i]` の `plannedMinutes` を visit/travel に分け、`slack = max(0, availableMinutes − plannedMinutes)`、合計で正規化。`issues` は種類ごとに 1 行(統合仕様 §5.5 の 8 種のうち鍵ゼロで起こる 6 種)。

- [ ] **Step 4: 実装(UI)**

```swift
// Screens/Plan/PlanScreen.swift(骨格)
struct PlanScreen: View {
  @Environment(PlannerStore.self) private var store
  var body: some View {
    @Bindable var store = store
    let app = AppCopy.for(store.request.locale)
    VStack(spacing: 0) {
      if store.view.mobileView == .timeline {
        ScrollView {
          VStack(alignment: .leading, spacing: 12) {
            HeroHeader()                                   // 1. 成立するか
            if let w = store.primaryWarning { WarningLine(warning: w) }   // 2. 警告 1 件
            DayTabs()                                      // 3. 日タブ + 日ヘッダー + 時間バー
            DayHeaderRow(index: store.view.selectedDay)
            TimelineList(dayIndex: store.view.selectedDay) // 4. 停留所(Task 7 が置換)
            if let spare = store.spareCapacityLine(store.view.selectedDay) { SpareLine(text: spare) }   // 5.
            Text(store.statsLine).font(Typography.stats)
            IssueCard(); VerdictDetails(); BeforeYouGoCard()          // Task 10 が置換
          }.padding(16)
        }
      } else { TripMapView() }                             // Task 8 が置換
    }
    .background(Tokens.Color.bg)
    .safeAreaInset(edge: .bottom) { SegmentedPills(selection: $store.view.mobileView, items: [(.timeline, app.timelineTab), (.map, app.mapTab)]).padding(.bottom, 8) }
    .toolbar { PlanToolbar() }                             // 編集 / ••• / 言語(言語ピルの中身は Task 14)
  }
}
```

`DayTabs`: `ScrollView(.horizontal)` の `Button` 群、選択はデイカラー塗り・非選択は輪郭、`accessibilityAddTraits(.isTabBar)` を親に、各タブ `.isSelected`、`accessibilityValue` に `density`。`DayTimeBar`: `GeometryReader` で 3 区間(visit=ink / travel=accent / slack=斜線 `Pattern` は `Canvas` で描く)+ マーカー、全体を 1 要素に `accessibilityLabel(bar.a11y)`。`BuildScreen`: `ProgressView` + 3 ステージの `VStack`(現在を太字)+ キャンセル(`store.cancelBuild()`)。

- [ ] **Step 5: ビルド・目視**(`screenshot.sh plan`)。確認: 既定 Dynamic Type でヒーロー・警告・日タブ・最初の停留所(Task 7 後)が初見に入る。 → **Step 6: Commit** — `git commit -m "The result screen answers its five questions in order"`

---

### Task 7: タイムライン(ホテルレグ・MovementCard・ActivityCard・食事行)

**Files:**
- Create: `apple/TripCheck/Screens/Plan/{ActivityCard,MovementCard,MealRow,HotelLegRow}.swift`
- Modify: `apple/TripCheck/Screens/Plan/TimelineList.swift`(Task 6 のプレースホルダを置換), `Sources/TripCheckAppCore/Store/PlannerStore+ViewModel.swift`(`timelineRows(day) -> [TimelineRow]`、`openInspector(_:)`、`closeInspector()`)
- Test: `Tests/TripCheckAppCoreTests/TimelineRowsTests.swift`

**Interfaces:**
- Produces: `enum TimelineRow: Identifiable { case hotelLeg(HotelLegModel), movement(MovementModel), activity(ActivityModel), meal(MealModel) }`、`ActivityModel { stopId, number: Int, time: String, name, areaAndStay: String(「エリア · 」+ `TimelinePresentation.stayLine(minutes:status:locale:)` = 「滞在の目安 1時間30分」/「滞在 2時間」), accessNote: String?, flags: [ActivityFlag](`TimelinePresentation.activityFlags(_:locale:)`), isFiller: Bool, colorHex }`、`MovementModel { legKey = routeLegKey(leg.from.id, leg.to.id), summary = TimelinePresentation.legHeadline(mode:minutes:transferCount:travelPreference:locale:)(「電車 95分・乗換1回」。**「約」や時間丸めは出ない**: 推定であることは `text.estimated` で別に示す), from, to, icon: String, options: [(mode: TransportMode, label: String, minutes: Int, selected: Bool, enabled: Bool)](`leg.comparison.options` から。`label = legModeLabel(mode, locale)`、`selected = edit.legModeOverrides[legKey] ?? leg.comparison.recommended.mode` と一致、`enabled = !(option.unroutable ?? false)`、徒歩は `leg.walkingMinutes <= 90` のときだけ enabled), walkMinutes: Int?(= `leg.walkingMinutes`), evidenceLine: String?(`TimelinePresentation.transitBoardingText(_:locale:)` ?? 推定なら `text.estimated`) }`、`MealModel { slotId, kind: MealKind, time, label }`(`slot: FoodRecommendationSlot` は `TimelinePresentation.mealSlotsAfterStop(daySlots, arrivals:, stopIndex:)` から。`time = slot.displayTime`、`label = TimelinePresentation.fillerRowLabel(slot.kind == .lunch ? .lunch : .dinner, locale:)` = 「昼食のおすすめ」/"Lunch recommendation"。`MealKind` と `TimelineFillerKind` は別の enum なので写像が要る)、`HotelLegModel { direction, label }`、`PlannerStore.openInspector(_ target: Inspector)`、`PlannerStore.closeInspector()`

- [ ] **Step 1: テスト**

```swift
@Test @MainActor func timelineRowsAlternateMovementAndActivity() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let rows = store.timelineRows(0)
  let kinds = rows.map { r -> String in if case .activity = r { return "A" }; if case .movement = r { return "M" }; if case .meal = r { return "F" }; return "H" }
  #expect(!kinds.isEmpty)
  #expect(kinds.first == "A" || kinds.first == "H")
  #expect(!kinds.joined().contains("MM"))
  #expect(rows.contains { if case .meal = $0 { return true }; return false })
}

@Test @MainActor func estimatedStayUsesTheWordMeyasuUntilTheTravellerSetsIt() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let rows = store.timelineRows(0)
  guard let a = rows.lazy.compactMap({ if case .activity(let m) = $0 { return m }; return nil }).first else { Issue.record("day 0 has no activity row"); return }
  #expect(a.areaAndStay.contains("目安"))   // TimelinePresentation.stayLine(.estimated, .ja)
  await store.setStayMinutes(stopId: a.stopId, minutes: 120)   // Task 9 のガード付き編集。Task 7 時点では PlannerStore+Edits の最小実装
  guard let b = store.timelineRows(0).lazy.compactMap({ if case .activity(let m) = $0, m.stopId == a.stopId { return m }; return nil }).first else { Issue.record("stop vanished"); return }
  #expect(!b.areaAndStay.contains("目安"))   // 指定した長さは「滞在」
}

@Test @MainActor func mealRowLabelComesFromTheKit() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let meals = store.timelineRows(0).compactMap { if case .meal(let m) = $0 { return m }; return nil }
  #expect(!meals.isEmpty)
  for m in meals { #expect(m.label == TimelinePresentation.fillerRowLabel(m.kind == .lunch ? .lunch : .dinner, locale: .ja)) }
}

@Test @MainActor func walkOptionOnlyUpToNinetyMinutes() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  var checked = 0
  for day in 0..<4 {
    for row in store.timelineRows(day) {
      if case .movement(let m) = row, let walk = m.options.first(where: { $0.mode == .walk }), let minutes = m.walkMinutes {
        checked += 1; #expect(walk.enabled == (minutes <= 90)); #expect(walk.minutes == minutes)
      }
    }
  }
  #expect(checked > 0)
}
```

(`setStayMinutes` は Task 9 の Produces。Task 7 では `PlannerStore+ViewModel.swift` に `openInspector`/`closeInspector` を、`Store/PlannerStore+Edits.swift` に `setStayMinutes`/`setLegMode` の**ガード無しの最小実装**(候補 → `BuildRunner.run` → commit)を置き、Task 9 がガード付きに拡張する。)

- [ ] **Step 2: 失敗を確認** → **Step 3: 実装** — `timelineRows` は `plan.days[i]` を `startBase → legs/stops → meal slots(TimelinePresentation.mealSlotsAfterStop)→ endBase` の順に畳む。`ActivityCard`: `Button`(行全体、≥44pt)= 時刻(`meta`)・デイカラーの番号ドット(Filler は `fork`/`spark` アイコン)・名前(`stopName`)・`areaAndStay`(`meta`)・アクセス注記・フラグチップ(`warnBg` 地、その日休み/最終入場後/予約に遅れる)。タップで `store.openInspector(.stop(a.stopId))`。`MovementCard(model:onSelectMode:)`: `DisclosureGroup` 風(手段アイコン・summary・`A → B`・シェブロン)、展開で手段ピッカー(`SegmentedPills`、各手段に `minutes` を添える、徒歩は `enabled` が偽なら無効)と証拠行。`onSelectMode` は Task 7 では `TimelineList` が `store.setLegMode(legKey:mode:)`(最小実装)を渡し、Task 9 でガード付きに差し替わる。`MealRow`: `Tokens.Color.recommendation` の破線枠(Task 1 の Tokens.swift に定義済み)、時刻と `label` のみ(候補は次 spec)。`HotelLegRow`: 「ホテルから 徒歩 約5分」相当の 1 行(34pt。文は Kit の `legHeadline` + `Copy` の拠点ラベル)。

- [ ] **Step 4: ビルド・目視** → **Step 5: Commit** — `git commit -m "The day reads top to bottom: leave the hotel, move, visit, eat, come back"`

---

### Task 8: 地図(MapKit)

**Files:**
- Create: `Sources/TripCheckAppCore/Map/{MapModel,GeoPoint+MapKit}.swift`, `apple/TripCheck/Map/{PinView,MapLegend}.swift`
- Modify: `apple/TripCheck/Map/TripMapView.swift`(Task 6 のプレースホルダを置換), `Sources/TripCheckAppCore/Store/PlannerStore+ViewModel.swift`(`mapModel(scope:) -> MapModel`)
- Test: `Tests/TripCheckAppCoreTests/MapModelTests.swift`

**Interfaces:**
- Produces: `public enum MapScope: Equatable, Sendable { case all, day }`、`public struct MapRegion: Equatable, Sendable { center: GeoPoint; latitudeDelta: Double; longitudeDelta: Double }`、`MapModel { pins: [MapPin: Identifiable { id, coordinate: GeoPoint, kind: anchor(number)|filler|meal(MealKind)|hotel|manual|warning, dayIndex, colorHex, label, a11y }], routes: [MapRoute: Identifiable { id, dayIndex, points: [GeoPoint], measured: Bool, selected: Bool }], region: MapRegion, legendDays: [(index, colorHex)] }`、`MapModel.region(for points: [GeoPoint], minimumSpan: Double = 0.006) -> MapRegion`、`PlannerStore.mapModel(scope: MapScope) -> MapModel`、`PlannerStore.focusStop(id:)`。`Map/GeoPoint+MapKit.swift`(AppCore、`import MapKit`): `extension GeoPoint { public var clLocation: CLLocationCoordinate2D }`、`extension MapRegion { public var mkRegion: MKCoordinateRegion }`(Kit の `GeoPoint` は latitude/longitude だけで CoreLocation を import しない)

- [ ] **Step 1: テスト**

```swift
@Test @MainActor func unmeasuredLegsAreDashedStraightLines() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let m = store.mapModel(scope: .all)
  #expect(!m.routes.isEmpty)
  #expect(m.routes.allSatisfy { !$0.measured })          // 鍵ゼロ: 計測済みの経路は無い
  #expect(m.routes.allSatisfy { $0.points.count == 2 })
  #expect(m.pins.filter { if case .anchor = $0.kind { return true }; return false }.count == 8)
  #expect(m.pins.allSatisfy { !$0.a11y.isEmpty })
}

@Test func degenerateBoundsGetAMinimumSpan() {
  let m = MapModel.region(for: [GeoPoint(latitude: 35.0, longitude: 139.0), GeoPoint(latitude: 35.001, longitude: 139.001)])
  #expect(m.latitudeDelta >= 0.006); #expect(m.longitudeDelta >= 0.006)
}
```

- [ ] **Step 2: 失敗を確認** → **Step 3: 実装**

```swift
// Map/TripMapView.swift(抜粋)
struct TripMapView: View {
  @Environment(PlannerStore.self) private var store
  @State private var camera: MapCameraPosition = .automatic
  var body: some View {
    @Bindable var store = store
    let model = store.mapModel(scope: store.view.mapScope)
    Map(position: $camera) {
      ForEach(model.routes) { r in
        MapPolyline(coordinates: r.points.map(\.clLocation))
          .stroke(Tokens.Day.color(index: r.dayIndex).opacity(r.selected ? 0.95 : 0.28),
                  style: StrokeStyle(lineWidth: r.selected ? 5 : 2, lineCap: .round, dash: r.measured ? [] : [2, 12]))
      }
      ForEach(model.pins) { pin in
        Annotation(pin.label, coordinate: pin.coordinate.clLocation, anchor: .bottom) {
          PinView(pin: pin, highlighted: store.view.mapFocusedStopId == pin.id)
            .onTapGesture { store.focusStop(id: pin.id); if case .anchor = pin.kind { store.openInspector(.stop(pin.id)) } }
        }.annotationTitles(.hidden)
      }
    }
    .mapStyle(.standard(pointsOfInterest: .excludingAll, showsTraffic: false))
    .mapControls { MapScaleView(); MapCompass() }
    .overlay(alignment: .bottomLeading) { MapLegend(days: model.legendDays, scope: $store.view.mapScope).padding(12) }
    .onChange(of: store.view.selectedDay) { _, _ in camera = .region(model.region.mkRegion) }
    .onAppear { camera = .region(model.region.mkRegion) }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("map")
  }
}
```

`PinView`: 円(デイカラー塗り + 白縁)+ 番号(`label` 11pt/800 白)、Filler は輪郭 + `spark`、食事 `fork`、ホテル `bed`、手動 `plus`、警告は右上に `!` バッジ。`MapLegend(days:scope: Binding<MapScope>)`: 見出し `text.legendLabel`、行は `text.legendMeasured`(実線の見本)/ `text.legendEstimated`(破線)/ `text.legendAnchor`(番号ドット)/ `text.legendSuggestion`(`spark` アイコン。✦ の字は使わない)、スコープピル `app.mapScopeAll | app.mapScopeDay`、折り畳み可。

- [ ] **Step 4: ビルド・目視**(地図タブ、破線が出る、ピンタップで詳細) → **Step 5: Commit** — `git commit -m "The map shows each day in its colour and never draws a route it has not measured"`

---

### Task 9: 詳細シート(StopInspector)・日の設定シート・ガード付き編集・Undo/Redo・トースト

**Files:**
- Create: `apple/TripCheck/Screens/Detail/{StopInspector,EvidenceDisclosure}.swift`, `apple/TripCheck/Screens/Plan/DaySettingsSheet.swift`, `apple/TripCheck/Components/Toast.swift`(ビュー。モデル `Model/Toast.swift` は Task 2 で作成済み)
- Modify: `Sources/TripCheckAppCore/Store/PlannerStore+Edits.swift`(Task 7 の最小実装をガード付きに), `apple/TripCheck/Screens/Plan/TimelineList.swift`(`MovementCard` の `onSelectMode` をガード付き `setLegMode` に配線), `apple/TripCheck/Screens/Plan/PlanScreen.swift`(`.sheet(item: $store.view.inspector)`、`.alert`、トースト)
- Test: `Tests/TripCheckAppCoreTests/GuardedEditFlowTests.swift`

**Interfaces:**
- Produces: `PlannerStore.applyGuardedEdit(_ mutate: (inout PlannerEditState) -> Void, label: String, fallbackTitle: String, extraConflicts: [String] = [], allowDropStopId: String? = nil) async`(候補 state → `BuildRunner.run` → `PlannerEdits.evaluate` → `.apply` なら `history.commit` + `bundle` 更新 + トースト / `.confirm` または `extraConflicts` 非空なら `view.pendingHardEdit = .edit(conflicts:extraConflicts:fallbackTitle:)` と `pendingApply` を置く)、`confirmPendingEdit() async`、`cancelPendingEdit()`、`undo() async`、`redo() async`(履歴の present から再ビルド)、`canUndo/canRedo`、11 アクション: `removeStop(id:)`(fallback = `AppCopy.removeStopQuestion(name:)`、`allowDropStopId = id`、must/予約なら `extraConflicts = [AppCopy.mustRemovalNote / reservationRemovalNote]` —— Web `usePlannerEdits.tsx:496-513` と同じ), `restoreStop(id:)`(`VerdictCopy.HardEditTitles.restoreStop`), `moveStop(id:, toDay:)`, `changeTripDays(_:)`(`request.tripDays = n` と候補 `edit.tripDays = n` を同時に書く: `tripRequest()` は `request.tripDays ?? edit.tripDays` なので), `setLegMode(legKey:, mode:)`(`HardEditTitles.legMode/legModeAuto`), `setStayMinutes(stopId:, minutes: Int?)`(`stayMinutes/stayMinutesAuto`), `setLastEntry(stopId:, time: String?)`(`lastEntry/lastEntryClear`), `setDayStart(day:, time:)`(`dayStart/dayStartAuto`), `setDayEnd(day:, time: String?)`(`dayEnd/dayEndAuto`), `applyAlternative(_ alt: TripCounterfactual)`, `setBase(_: ResolvedStop?)`(後 3 つの fallback は `AppCopy`);
  `PlannerStore.inspector(for stopId) -> StopInspectorModel { number, name, meta, dayOptions: [Int], stayOptions: [Int?](自動/30/45/60/90/120/150/180/240), currentStay, lastEntry, stayStatus: EvidenceStatus, stayHeadline: String, stayBasisLine: String, evidenceLines: [(label: String, value: String, status: String)], mapsUrl: URL?, appleMapsUrl: URL?, canRemove }`

- [ ] **Step 1: テスト**

```swift
@Test @MainActor func harmlessEditAppliesAndIsOneUndo() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let id = store.bundle!.plan.days[0].stops[0].stop.id
  await store.setStayMinutes(stopId: id, minutes: 120)
  #expect(store.edit.userStayMinutes[id] == 120); #expect(store.view.toast != nil); #expect(store.canUndo)
  if let detail = VerdictCopy.bufferToastDetail(-30, locale: .ja) { #expect(detail == VerdictCopy.bufferDeltaLine(-30, locale: .ja)) }   // トースト文は Kit から。手書きの「余裕 -30分」は書かない
  await store.undo()
  #expect(store.edit.userStayMinutes[id] == nil); #expect(store.canRedo)
}

@Test @MainActor func removingAMustStopAsksFirst() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland)
  store.request.entries[0].priority = .must
  await store.build()
  let id = store.bundle!.plan.days.flatMap(\.stops).first { $0.priority == .must }!.stop.id
  await store.removeStop(id: id)
  guard case .edit(let conflicts, let extra, let title)? = store.view.pendingHardEdit else { Issue.record("a must stop must be asked about"); return }
  #expect(conflicts.isEmpty)        // 外す本人の must は allowDropStopId で数えない(Kit hardEditConflicts)
  #expect(extra.count == 1)         // 「…は必須に指定されています」(AppCopy.mustRemovalNote)
  #expect(PlannerEdits.confirmTitle(conflicts: conflicts, extraConflicts: extra, fallback: title, locale: .ja) == title)
  #expect(!store.edit.removedStops.contains { $0.id == id })
  await store.confirmPendingEdit()
  #expect(store.edit.removedStops.contains { $0.id == id })
}

@Test @MainActor func changingDaysReRunsTheSameEngineNotACopy() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  await store.changeTripDays(5)
  #expect(store.bundle?.plan.days.count == 5); #expect(store.bundle?.request.days == 5); #expect(store.request.tripDays == 5)
}
```

- [ ] **Step 2: 失敗を確認** → **Step 3: 実装(AppCore)** — `applyGuardedEdit`: `var candidate = edit; mutate(&candidate)`; `let before = bundle!`; `let req = tripRequest(with: candidate)`; `let after = await Task.detached { BuildRunner.run(req) }.value`; 世代ガード; `switch PlannerEdits.evaluate(before: before.plan, after: after.plan, context: before.request.context, candidateContext: req.context, locale: req.locale, allowDropStopId: allowDropStopId)`(**`context` は今の文脈、`candidateContext` は候補の文脈**。日の窓を動かす編集で余裕の差が正しく出る。`locale` は既定 `.ja` なので必ず渡す)。`.apply(bufferDeltaMinutes:)` かつ `extraConflicts.isEmpty` → `history = history.commit(candidate); edit = candidate; bundle = after; view.toast = Toast(id: UUID(), text: [label, VerdictCopy.bufferToastDetail(delta, locale: request.locale)].compactMap { $0 }.joined(separator: " "), kind: .edit, canUndo: true)`(`bufferToastDetail` は 0 のとき nil = 「±0」を出さない)。6 秒で自動消去(`Task.sleep`、`reduceMotion` 非依存)。`.confirm(conflicts)` または `extraConflicts` 非空 → `view.pendingHardEdit = .edit(conflicts: conflicts, extraConflicts: extraConflicts, fallbackTitle: fallbackTitle)`、`pendingApply = { … 上の apply と同じ … }`。`undo()`: `history = history.undo(); edit = history.present; rebuild(silent)`。
  `inspector(for:)`: `stayStatus = bundle.evidence.facts.first { $0.kind == .stay_duration && $0.id == "duration:\(id)" }?.evidence.status ?? .estimated`(Web `useTripDomainModel.tsx:533-539` と同じ。`edit.userStayMinutes` から導かない)、`stayHeadline = TimelinePresentation.stayLine(minutes: currentStay, status: stayStatus, locale:)`、`stayBasisLine = TimelinePresentation.stayBasisLine(stayStatus, locale:)`、`evidenceLines = bundle.evidence.facts.filter { $0.id == "place:\(id)" || $0.id == "duration:\(id)" || $0.id.hasPrefix("hours:\(id):") || $0.id.hasPrefix("last-entry:\(id):") }.map { ($0.label, valueText($0.evidence.value), TimelinePresentation.durationSourceLabel($0.evidence.status, locale:)) }`(`valueText` は `JSONValue?` → 文字列、nil は "—")、`mapsUrl = URL(string: TripPresentation.googleMapsSearchUrl(stop))`(Kit は `String` を返す)、`appleMapsUrl` は `URLComponents`(host `maps.apple.com`、`ll=lat,lon`、`q=name`)で AppCore が組む(Kit に Apple Maps の補助は無い)。どちらも nil ならリンクを出さない。

- [ ] **Step 4: 実装(UI)** — `PlanScreen`(body 先頭の `@Bindable var store = store` は Task 6 で宣言済み)に `.sheet(item: $store.view.inspector) { target in switch target { case .stop(let id): StopInspector(stopId: id); case .daySettings(let d): DaySettingsSheet(day: d) } }` + `.presentationDetents([.fraction(0.3), .medium, .large], selection: detent)`、`.presentationDragIndicator(.visible)`。`StopInspector` の中身: ヘッダー(番号ドット・名前・`meta`、閉じる `close`)/「日を移動」`SegmentedPills`(複数日のみ)/ `EvidenceDisclosure`(`DisclosureGroup` の題は `TimelinePresentation.evidenceDisclosureLabel(locale)`: `stayHeadline`・`stayBasisLine`、事実ごとに `label: value(status 語)`)/ `DisclosureGroup`「この場所の条件を変える」(滞在 `Picker`、最終入場 `DatePicker` + クリア)/ `Link`「Apple Maps で開く」「Google Maps で開く」(`text.mapReady` は Google 側のラベル)/ **最後に** 赤文字ボタン「予定から外す」(`accessibilityIdentifier("detail.remove")`)。`DaySettingsSheet`: 一日の開始 `Picker`(08:00/09:00/10:30 + 任意時刻)、終了(なし/19:30/21:30 + 任意)。`pendingHardEdit` は `.alert(isPresented:)`: 題は `case .edit(let c, let extra, let fallback)` → `PlannerEdits.confirmTitle(conflicts: c, extraConflicts: extra, fallback: fallback, locale: locale)`(予約遅れ 1 件だけのとき Kit の「この変更で予約にN分遅れます」になる)、本文は `(c.map(\.message) + extra).joined(separator: "\n")`、ボタン「外さない」「外す」相当(`Copy` の既存鍵)。`case .mustUnresolved(let names)` は Task 5 の文。`Toast`: 画面下のピル(`accessibilityAddTraits(.updatesFrequently)` + `AccessibilityNotification.Announcement`、`accessibilityIdentifier("toast")`、Undo ボタンは `"toast.undo"`)。シェイク Undo: `UIWindow.motionEnded` を `NotificationCenter` 経由で `store.undo()`、`⌘Z`/`⇧⌘Z` は `.keyboardShortcut`。

- [ ] **Step 5: ビルド・目視**(外す → 確認 → トースト → 元に戻す) → **Step 6: Commit** — `git commit -m "Every change goes through the guard, and one shake brings the plan back"`

---

### Task 10: IssueCard・結論の詳細(日数ステッパー・代替案 ≤3・仮定・カバレッジ)・出発前チェック

**Files:**
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckKit/Destinations/PreTripTimeline.swift`(**Kit への加法的な追加**: `lib/pre-trip-timeline.ts` の純粋な移植), `apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Units/PreTripTimelineTests.swift`, `Sources/TripCheckAppCore/Store/PlannerStore+BeforeYouGo.swift`
- Modify: `apple/TripCheck/Screens/Plan/{IssueCard,VerdictDetails,BeforeYouGoCard}.swift`(Task 6 のプレースホルダを置換)
- Test: `Tests/TripCheckAppCoreTests/{VerdictDetailsModelTests,BeforeYouGoTests}.swift`

**Interfaces:**
- Produces(Kit): `public enum PreTripUrgency: String, Sendable { case overdue, due_soon, scheduled, info }`、`public struct PreTripItem: Equatable, Sendable { id: String; dueDate: CalendarDate?; opensDate: CalendarDate?; urgency: PreTripUrgency; label: [PlannerLocale: String]; detail: [PlannerLocale: String]; url: String? }`、`extension CalendarDate { public func adding(months: Int) -> CalendarDate }`(月末クランプ = TS `addMonthsUtc`。`daysIn(month:year:)` は同じモジュールなので内部のまま使える)、`public enum PreTripTimeline { public static let dueSoonDays = 7; public static func build(tripStartDate: CalendarDate?, tripEndDate: CalendarDate?, authority: EntryAuthority?, passportRule: PassportRule?, passportExpiry: CalendarDate?, today: CalendarDate) -> [PreTripItem] }`(規則は `lib/pre-trip-timeline.ts:70-207`、並びは `:221-224`: overdue < due_soon < scheduled < info、同順位は dueDate 昇順で nil は最後。`detail` は常に `authority.summary` / `passportRule.summary`)
- Produces(AppCore): `PlannerStore.verdictDetails -> VerdictDetailsModel { daysStepper: (value, min: 1, max: 14), factCounts: (verified, estimated, unknown)(`result.criticalFacts`), coverage: (label, hasUnknown), comparison: (original, minimalRepair, shortest)?(existing_itinerary のみ), alternatives: [AlternativeModel { id, title(`VerdictCopy.alternativeCopy(_:locale:).title`), diff: [(label, before, after)], lossLine: String?(`VerdictCopy.alternativeLossCopy`), apply: TripCounterfactual }], assumptions: [String](`VerdictCopy.assumptionCopy`), attentions: [String] }`(**diff は生の分と件数**: Web `VerdictDetails.tsx:226-242` と同じく `hardConflictCount` は `String(n)`、`overrunMinutes`/`travelMinutes` は `"\(n)" + (ja ? "分" : " min")`、`minimumSlackMinutes` は `Int?` なので `map { … } ?? "—"`(負の値はそのまま)。`scheduledStopCount`/`dayCount` の行も出す。`TripPresentation.formatDuration` は使わない: 件数を時間に見せ、負の余白を 0 に丸め、「1時間30分」に変えてしまう)、`PlannerStore.beforeYouGo -> BeforeYouGoModel { passportCountry: PassportCountry(unset|jp|other), passportExpiry: String?, items: [BeforeYouGoItem { id, urgency: PreTripUrgency, label, detail, url: URL? }], medicineLines: [String], essentials: [(label, value)] }`、`PlannerStore.setPassportCountry(_:)`, `setPassportExpiry(_:)`(`UserDefaults` `tripcheck.passportExpiry`。国は保存しない = Web と同じ)

- [ ] **Step 1: テスト**

```swift
// Tests/TripCheckKitTests/Units/PreTripTimelineTests.swift(Kit。TS の規則から採った例)
@Test func schengenPassportShortByTwoWeeksIsOverdue() {
  let items = PreTripTimeline.build(tripStartDate: CalendarDate("2026-10-13"), tripEndDate: CalendarDate("2026-10-16"),
                                    authority: nil, passportRule: Destinations.passportRule(Destinations.byId(.switzerland)),
                                    passportExpiry: CalendarDate("2027-01-01"), today: CalendarDate("2026-08-23")!)
  #expect(items.map(\.id) == ["passport"])
  #expect(items[0].urgency == .overdue)                       // 出国日 + 3 か月 = 2027-01-16 > 期限
  #expect(items[0].label[.ja]?.contains("パスポート") == true)
}
@Test func monthArithmeticClampsToEndOfMonth() {
  #expect(CalendarDate("2026-01-31")!.adding(months: 1) == CalendarDate("2026-02-28")!)
  #expect(CalendarDate("2026-11-30")!.adding(months: 3) == CalendarDate("2027-02-28")!)
}
@Test func ketaWaiverPastItsDateChangesTheLabelNotTheDetail() {
  let items = PreTripTimeline.build(tripStartDate: CalendarDate("2027-02-01"), tripEndDate: CalendarDate("2027-02-03"),
                                    authority: Destinations.entryAuthority(Destinations.byId(.korea)), passportRule: nil, passportExpiry: nil, today: CalendarDate("2026-08-23")!)
  guard let keta = items.first(where: { $0.id.hasPrefix("authority-") }) else { Issue.record("no authority item"); return }
  #expect(keta.urgency == .info)
  #expect(keta.label[.ja]?.contains("期間外") == true)         // detail は summary のまま(「…まで免除」を含む)
}
```

```swift
// Tests/TripCheckAppCoreTests/{VerdictDetailsModelTests,BeforeYouGoTests}.swift
@Test @MainActor func alternativesShowRealDiffAndApplyGoesThroughGuard() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); store.request.tripDays = 2; await store.build()
  let alts = store.verdictDetails.alternatives
  #expect(alts.count <= 3)
  guard let first = alts.first else { Issue.record("8 stops in 2 days should yield at least one alternative"); return }
  #expect(first.diff.count >= 5)                                           // 衝突・超過・移動・最小余白・訪問数/日数
  #expect(first.diff.allSatisfy { !$0.before.contains("時間") && !$0.after.contains("時間") })   // 生の分 "90分"。formatDuration の「1時間30分」ではない
  #expect(first.diff.map(\.label) == AppCopy.for(.ja).diffLabels)
  await store.applyAlternative(first.apply)
  #expect(store.canUndo || store.view.pendingHardEdit != nil)
}

@Test @MainActor func passportRuleOnlyJudgesJapanesePassports() async {
  let store = PlannerStore(resolvers: [], store: nil); store.loadSample(.switzerland)
  store.request.tripStartDate = "2026-10-13"   // tripDays = 4 は loadSample が置く。build() 無しでも request から start/end を導く
  store.setPassportCountry(.other); #expect(store.beforeYouGo.items.isEmpty)   // Web と同じ: JP 以外は判定しない(空)
  store.setPassportCountry(.jp); store.setPassportExpiry("2027-01-01")
  // スイス(Schengen)は出国日 2026-10-16 + 3 か月 = 2027-01-16 まで必要 → 不足
  let passport = store.beforeYouGo.items.first { $0.id == "passport" }
  #expect(passport?.urgency == .overdue)
  #expect(passport?.label.contains("パスポート") == true)
}

@Test @MainActor func etiasIsNotRequiredYetAndKEtaExpiresEndOf2026() async {
  let fr = PlannerStore(resolvers: [], store: nil); fr.setPassportCountry(.jp)
  fr.request.destination = .destination(.france); fr.request.tripStartDate = "2026-10-13"; fr.request.tripDays = 3
  #expect(fr.beforeYouGo.items.first { $0.label.contains("ETIAS") }?.urgency == .info)
  let kr = PlannerStore(resolvers: [], store: nil); kr.setPassportCountry(.jp)
  kr.request.destination = .destination(.korea); kr.request.tripStartDate = "2027-02-01"; kr.request.tripDays = 3
  let keta = kr.beforeYouGo.items.first { $0.label.contains("K-ETA") }
  #expect(keta?.urgency == .info)
  #expect(keta?.label.contains("期間外") == true)   // 免除期間(2026-12-31)を過ぎた旅行。detail は常に summary で「免除」を含むので detail には表明しない
}
```

- [ ] **Step 2: 失敗を確認** → **Step 3: 実装** — `VerdictDetailsModel` は `bundle.result/fit/counterfactuals` から。`PreTripTimeline`(Kit)は `import Foundation` だけで書く。`PlannerStore.beforeYouGo`(AppCore)は Web の hook(`useTripDomainModel.tsx:724-734`)と同じゲート: `passportCountry == .jp` のときだけ `Destinations.entryAuthority(dest)` / `Destinations.passportRule(dest)` を渡し、それ以外は両方 nil(→ items は空)。日付は `bundle?.plan.days` の date があればその先頭/末尾、無ければ `request.tripStartDate` と `request.tripDays ?? edit.tripDays` から start/end(`CalendarDate.adding(days: n - 1)`)。`today` は `Calendar(identifier: .gregorian)` UTC の今日。`label/detail` は `request.locale` で引く。UI: `IssueCard`(「確認したいこと N」+ 種類ごと 1 行 + 行動ボタン)、`VerdictDetails`(`DisclosureGroup`「結論の詳細」: `Stepper` 1–14(`accessibilityValue` に日数)、3 数、カバレッジ、代替案カード(diff テーブル + 「この変更を適用」)、仮定・注意の箇条書き)、`BeforeYouGoCard`(旅券国 `SegmentedPills` unset/JP/other、JP のときだけ `DatePicker`、`overdue/due_soon` を `danger/warn` 色、公式リンク `Link`、薬の固定行)。

- [ ] **Step 4: ビルド・目視** → **Step 5: Commit** — `git commit -m "Below the plan: what to check, what else would work, and what to do before leaving"`

---

### Task 11: 保存・最近の旅程・自動保存・再開

**Files:**
- Create: `Sources/TripCheckAppCore/Store/PlannerStore+Persistence.swift`, `Sources/TripCheckAppCore/Model/PersistedTrip.swift`, `apple/TripCheck/Screens/Start/RecentTripsSection.swift`
- Test: `Tests/TripCheckAppCoreTests/PersistenceFlowTests.swift`

**Interfaces:**
- Produces: `PlannerStore.recentTrips: [StoredTripRecord]`、`PlannerStore.loadRecent() async`、`PlannerStore.storageUnavailable: Bool`(**init で `trips/` ディレクトリの作成を試す eager な探りで即時に立て**、以後の保存で `TripStoreError.ioFailure` が出ても立てる。`TripStore` 自身は `save/write` までディスクに触らず、`list()/load()` は投げない)、`PlannerStore.openTrip(id:) async`、`PlannerStore.deleteTrip(id:) async`、自動保存(`autosaveDebounce`、`request.entries`/`edit` の変化で)。
  **`UserTripPayload` には Kit の `ResolvedStop` も `PlannerEditState` も直接入れない**(`ResolvedStop` は `sourceUrl`/`verifiedAt` を必ず符号化し、`PlannerEditState` は `resolvedStops`/`resolvedBase` を必ず符号化する。`UserTripPayload.validate` は入れ子の全鍵を `normalizedKey` で `forbiddenKeys`(`sourceurl`, `verifiedat`, `placetypes`, `resolvedstops`, `resolvedbase` …)と照合して投げるので、保存が毎回失敗する):
  `input` = `PersistedTripInput: Codable`(`TripRequestState` の写し。`resolutions`/`mixedCountryCodes` は除く。各 entry の pin は `PersistedPin { kind: "apple"|"manual"|"catalog", providerRef: String?, name, area, address, latitude, longitude, planningDurationMinutes, userProvidedCoordinates: Bool? }` —— sourceUrl/verifiedAt/placeTypes/countryCode は持たない)、`edits` = `PersistedEdits: Codable`(`PlannerEditState` から `resolvedStops`/`resolvedBase` を除いた射影: tripDays, pace, hotelQuery, travelPreference, transferBufferMinutes, userStayMinutes, lastEntryTimes, dayStartTimes, dayEndTimes, legModeOverrides, dayOverrides, lockedOrderByDay, removedStops, itinerary, mealSelections, resolutionOverrides)。`openTrip` は pin から `ResolvedStop(id: "pin-\(index)", providerRef:, name:, area:, latitude:, longitude:, sourceUrl: "", verifiedAt: "", confidence: .medium, planningDurationMinutes:, isAnchor: true, userProvidedCoordinates:, input: entry.text, inputIndex: index, address:, provider: kind に応じて .apple/.user/.catalog)` を組み直し(`.apple` は座標ごと `estimated` のまま再利用)、`.catalog` の pin とホテルは再解決、`edit.resolvedStops` は `PlannerEdits.applyManualOverrides(stops, overrides: persisted.resolutionOverrides)` で戻す。`request.tripDays = persisted.tripDays`。

- [ ] **Step 1: テスト**

```swift
@Test @MainActor func persistedPayloadNeverCarriesForbiddenKeys() async throws {
  let store = PlannerStore(resolvers: [], store: nil); store.loadSample(.switzerland)
  let apple = ResolvedStop(id: "apple-0-1", name: "Bern", area: "Bern", latitude: 46.9, longitude: 7.4, sourceUrl: "", verifiedAt: "", confidence: .medium, planningDurationMinutes: 60, isAnchor: true, input: "Bern", inputIndex: 0, address: "Bern", countryCode: "CH", provider: .apple)
  store.request.entries[0].pinned = .apple(providerRef: nil, stop: apple)
  store.setManualPin(entryId: store.request.entries[1].id, name: "Somewhere", address: "", latitude: 1, longitude: 2)
  let payload = try store.persistedPayload()                       // UserTripPayload.validate(input:edits:) を通る
  func walk(_ v: JSONValue) -> [String] { if case .object(let o) = v { return o.keys.map { UserTripPayload.normalizedKey($0) } + o.values.flatMap(walk) }; if case .array(let a) = v { return a.flatMap(walk) }; return [] }
  let keys = walk(payload.jsonValue)
  #expect(!keys.isEmpty)
  #expect(Set(keys).isDisjoint(with: UserTripPayload.forbiddenKeys))
  #expect(payload.edits["resolvedStops"] == nil); #expect(payload.edits["resolvedBase"] == nil)
}

@Test @MainActor func autosaveWritesInputAndEditsOnly() async throws {
  let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  let store = PlannerStore(resolvers: [CatalogResolver()], store: TripStore(directory: dir), autosaveDebounce: .milliseconds(10))
  store.loadSample(.switzerland); await store.build()
  try await Task.sleep(for: .milliseconds(50))
  await store.loadRecent()
  guard let rec = store.recentTrips.first else { Issue.record("autosave did not write"); return }
  #expect(rec.payload.input["entries"] != nil); #expect(rec.payload.edits["tripDays"] != nil)
  #expect(rec.payload.input["plan"] == nil)
  #expect(rec.payload.edits["resolvedStops"] == nil); #expect(rec.payload.edits["resolvedBase"] == nil)
}

@Test @MainActor func reopeningRebuildsFromInputAndKeepsEdits() async throws {
  let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  let s1 = PlannerStore(resolvers: [CatalogResolver()], store: TripStore(directory: dir), autosaveDebounce: .milliseconds(10))
  s1.loadSample(.switzerland); await s1.build(); await s1.changeTripDays(5); try await Task.sleep(for: .milliseconds(50))
  let s2 = PlannerStore(resolvers: [CatalogResolver()], store: TripStore(directory: dir))
  await s2.loadRecent()
  guard let id = s2.recentTrips.first?.id else { Issue.record("nothing saved"); return }
  await s2.openTrip(id: id)
  #expect(s2.bundle?.plan.days.count == 5)
}

@Test @MainActor func storageFailureFallsBackToMemoryWithAWarning() async {
  // 起動時に書けないことが分かる —— 最初の保存まで黙っていない(init の eager な探り)
  let store = PlannerStore(resolvers: [], store: TripStore(directory: URL(fileURLWithPath: "/dev/null/impossible")))
  #expect(store.storageUnavailable)
  store.loadSample(.switzerland); await store.build()
  #expect(store.bundle != nil); #expect(store.storageUnavailable)
}
```

- [ ] **Step 2: 失敗を確認** → **Step 3: 実装** — `persistedPayload() throws -> UserTripPayload` は `JSONEncoder` → `JSONValue` → `UserTripPayload.validate(input:edits:)`。`RecentTripsSection`: 「プランに戻る」(bundle があるとき)、非永続警告(`storageUnavailable`)、最近の旅程(タイトル = 先頭 3 か所の名前、開く/削除 スワイプ)。

- [ ] **Step 4: ビルド・目視**(アプリを kill → 再起動 → 最近の旅程から開く) → **Step 5: Commit** — `git commit -m "Trips stay on the phone and come back exactly as edited"`

---

### Task 12: 共有(Web 互換リンク + tripcheck://)と URL での取込

**Files:**
- Create: `Sources/TripCheckAppCore/Store/PlannerStore+Share.swift`, `apple/TripCheck/Screens/Share/ShareSheet.swift`
- Modify: `apple/TripCheck/App/TripCheckApp.swift`(`.onOpenURL`)
- Test: `Tests/TripCheckAppCoreTests/ShareFlowTests.swift`

**Interfaces:**
- Produces: `PlannerStore.shareableInput() -> ShareableTripInput`、`PlannerStore.sharePreview(scope: ShareScopeOptions) -> ScopedShareResult`(= `ShareScope.scoped(shareableInput(), scope: scope, locale: request.locale)`)、`PlannerStore.shareURLs(scope: ShareScopeOptions) -> (web: URL, app: URL)?`(`https://tripcheck-japan-tokyo.syoki.chatgpt.site/\(locale == .ja ? "ja" : "")#t=\(code)` と `tripcheck://t/\(code)`。`blocked` なら nil)、`PlannerStore.importShare(code:) async -> Bool`(`ShareCodec.decode(code)` → `request`(`tripDays` を含む)と `edit` に展開 → build)、`static func shareCode(from url: URL) -> String?`(両形式)

- [ ] **Step 1: テスト**

```swift
@Test @MainActor func shareRoundTripsThroughTheAppScheme() async {
  let s1 = PlannerStore(resolvers: [CatalogResolver()], store: nil); s1.loadSample(.switzerland); await s1.build(); await s1.changeTripDays(5)
  guard let urls = s1.shareURLs(scope: ShareScopeOptions(dates: true, hotel: false, airports: false, reservations: false)) else { Issue.record("share was blocked"); return }
  #expect(urls.web.absoluteString.hasPrefix("https://tripcheck-japan-tokyo.syoki.chatgpt.site/ja#t="))
  guard let code = PlannerStore.shareCode(from: urls.app) else { Issue.record("app url has no code"); return }
  #expect(code == PlannerStore.shareCode(from: urls.web))
  let s2 = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  let imported = await s2.importShare(code: code)
  #expect(imported)
  #expect(s2.edit.tripDays == 5); #expect(s2.request.tripDays == 5); #expect(s2.request.entries.count == 8)
}

@Test @MainActor func reservationsAreRedactedUnlessIncluded() async {
  let s = PlannerStore(resolvers: [CatalogResolver()], store: nil); s.loadSample(.switzerland)
  s.request.entries[0].isReservation = true; s.request.entries[0].fixedTime = "10:00"; await s.build()
  #expect(s.sharePreview(scope: ShareScopeOptions(dates: true, hotel: false, airports: false, reservations: false)).redactedReservationCount == 1)
  #expect(s.sharePreview(scope: ShareScopeOptions(dates: true, hotel: false, airports: false, reservations: true)).warnings.contains(.RESERVATION_DETAILS_INCLUDED))
}
```

- [ ] **Step 2: 失敗を確認** → **Step 3: 実装** — `ShareSheet`(`@Bindable var store = store`): 4 つの `Toggle`(既定 dates のみ ON)、墨消し件数・省略行・警告の文(`ShareWarningCode` ごとに `Copy` の鍵)、`blocked` なら CTA 無効、`ShareLink(item: web, subject:)` 「この内容でリンクをコピー」と「アプリ用リンク」の 2 つ。`.onOpenURL { if let code = PlannerStore.shareCode(from: $0) { Task { await store.importShare(code: code) } } }`。

- [ ] **Step 4: ビルド・目視**(`xcrun simctl openurl booted "tripcheck://t/<code>"` で取込) → **Step 5: Commit** — `git commit -m "A link from the phone opens on the web, and a web link opens on the phone"`

---

### Task 13: 印刷シート(PDF)

**Files:**
- Create: `apple/TripCheck/Screens/Print/{TripPrintSheet,PDFExporter}.swift`
- Modify: `Sources/TripCheckAppCore/Store/PlannerStore+ViewModel.swift`(`printModel -> PrintModel`)
- Test: `Tests/TripCheckAppCoreTests/PrintModelTests.swift`

**Interfaces:**
- Produces: `PrintModel { title, verdict, assumptions: [String], coverage: String, conflicts: [String], airportNotes: [String], days: [(label, date, rows: [(time, name, address, stay, arrival, departure)])], holidays: [String] }`(`holidays` は鍵ゼロでは常に空)、`PDFExporter.render(_ view: some View, pageWidth: CGFloat = 612) -> URL`(`ImageRenderer` + `UIGraphicsPDFRenderer`、A4/Letter 幅、複数ページは `proposedSize` の高さで分割)

- [ ] **Step 1: テスト(AppCore)** — `printModel` が全日程・全停留所を含み、`BannedTerms` を通ること。

```swift
@Test @MainActor func printModelListsEveryStopWithFullTimes() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let p = store.printModel
  #expect(p.days.count == 4); #expect(p.days.flatMap(\.rows).count == 8)
  #expect(p.days.flatMap(\.rows).allSatisfy { !$0.arrival.isEmpty && !$0.departure.isEmpty })
  #expect(BannedTerms.violations(in: p.verdict).isEmpty)
}
```

- [ ] **Step 2: 実装** — `TripPrintSheet` は白地・黒字・地図なし、`Typography` の印刷用サイズ(下限規則の対象外)。`•••` メニュー「印刷」→ `PDFExporter.render` → `ShareLink(item: url)` の `.sheet`。

- [ ] **Step 3: ビルド・目視**(PDF を Files に保存して開く) → **Step 4: Commit** — `git commit -m "The whole trip fits on paper, without the map"`

---

### Task 14: 言語切替・アクセシビリティ・Dynamic Type・UI テスト・検証スクリプト

**Files:**
- Create: `apple/TripCheckUITests/PlannerFlowTests.swift`, `apple/TripCheckTests/{CopyBoundaryTests,IconCoverageTests}.swift`(App の単体テストターゲット。`@testable import TripCheck` + `import TripCheckKit`。`IconShape` は App 側の型なので AppCore のテストには置けない)
- Modify: `apple/project.yml`(`TripCheckTests: { type: bundle.unit-test, platform: iOS, sources: [TripCheckTests], dependencies: [{ target: TripCheck }] }` を足し、TripCheck の `scheme.testTargets: [TripCheckTests, TripCheckUITests]` に), `apple/tools/verify-app.sh`(`test` で両テストターゲット), `apple/TripCheck/Screens/Plan/PlanToolbar.swift`(言語ピル), `apple/README.md`

- [ ] **Step 1: 言語切替** — `PlanToolbar` の `日本語 | EN`(`SegmentedPills`)→ `store.changeLocale(_:)`: `request.locale` を変え、`bundle` は**捨てない**(hero/行は `locale` から再導出されるので表示だけ変わる)、実行中ビルドは `buildGeneration += 1` で中断。初期値は `Locale.current.language.languageCode?.identifier == "ja" ? .ja : .en`(`languageCode` は `Locale.LanguageCode?` で文字列ではない)、`UserDefaults["tripcheck-locale"]` があればそれ。

- [ ] **Step 2: 文言・アイコンの走査テスト(App 単体テスト `TripCheckTests`)**

```swift
import Testing
import TripCheckKit
@testable import TripCheck

@Test func noViewFileContainsJapaneseOrEnglishSentenceLiterals() throws {
  // apple/TripCheckTests/CopyBoundaryTests.swift から 2 回上がると apple/。走査は apple/TripCheck(Design/ を除く)と AppCore の Sources(Presentation/AppCopy.swift を除く)
  let apple = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
  let roots = [apple.appendingPathComponent("TripCheck"), apple.appendingPathComponent("Packages/TripCheckKit/Sources/TripCheckAppCore")]
  let jp = try JSRegex("\"[^\"]*[぀-ヿ㐀-鿿][^\"]*\"")
  let inline = try JSRegex("Text\\(\"([^\"]{12,})\"\\)")
  var scanned = 0
  for root in roots {
    for f in try FileManager.default.subpathsOfDirectory(atPath: root.path) where f.hasSuffix(".swift") && !f.contains("Design/") && !f.hasSuffix("AppCopy.swift") {
      scanned += 1
      let text = try String(contentsOf: root.appendingPathComponent(f), encoding: .utf8)
      #expect(jp.matches(in: text).isEmpty, "\(f) has a Japanese literal — move it to AppCopy (or use a Kit Copy key)")
      for m in inline.matches(in: text) { Issue.record("\(f): inline Text literal \(m.groups[0] ?? "")") }
    }
  }
  #expect(scanned > 20)
}

@Test func everyIconHasAPath() {
  let box = CGRect(x: 0, y: 0, width: 24, height: 24)
  for icon in Icon.allCases { #expect(!IconShape(icon: icon).path(in: box).isEmpty, icon.rawValue) }
  for icon in [Icon.mark, .signal, .train, .walk] { #expect(!IconFillShape(icon: icon).path(in: box).isEmpty, "\(icon.rawValue) fill layer") }
}
```

`AppCopy` の ja/en 表が `BannedTerms` を通ることは Task 2 の `appCopyPassesBannedTermsInBothLanguages`(AppCore)で固定済み。鍵を足したらそのテストの配列にも足す。

- [ ] **Step 3: UI テスト**

```swift
import XCTest
final class PlannerFlowTests: XCTestCase {
  func testSampleToPlanToDetailToRemoveToUndo() {
    let app = XCUIApplication(); app.launchArguments = ["-uiTesting"]; app.launch()
    app.buttons["start.seeExample"].tap()
    XCTAssertTrue(app.staticTexts["plan.hero"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["plan.dayTab.0"].isSelected)
    app.buttons["plan.dayTab.1"].tap()
    XCTAssertTrue(app.buttons["plan.dayTab.1"].isSelected)
    let firstStop = app.buttons.matching(identifier: "plan.activity").firstMatch
    XCTAssertTrue(firstStop.isHittable)                      // 初見に最初の停留所
    firstStop.tap()
    XCTAssertTrue(app.otherElements["detail.sheet"].waitForExistence(timeout: 3))
    app.buttons["detail.remove"].tap()
    if app.alerts.firstMatch.waitForExistence(timeout: 1) { app.alerts.buttons.element(boundBy: 1).tap() }
    XCTAssertTrue(app.otherElements["toast"].waitForExistence(timeout: 3))
    app.buttons["toast.undo"].tap()
    XCTAssertFalse(app.otherElements["toast"].exists)
  }
  func testFirstViewportContractAtDefaultType() {
    let app = XCUIApplication(); app.launchArguments = ["-uiTesting"]; app.launch()
    app.buttons["start.seeExample"].tap()
    XCTAssertTrue(app.staticTexts["plan.hero"].waitForExistence(timeout: 10))
    let stop = app.buttons.matching(identifier: "plan.activity").firstMatch
    XCTAssertTrue(stop.frame.maxY <= app.frame.height, "first stop must be visible without scrolling (spec §10)")
  }
  func testSwitchingToMapAndBack() {
    let app = XCUIApplication(); app.launchArguments = ["-uiTesting"]; app.launch()
    app.buttons["start.seeExample"].tap(); _ = app.staticTexts["plan.hero"].waitForExistence(timeout: 10)
    app.buttons["plan.view.map"].tap(); XCTAssertTrue(app.otherElements["map"].waitForExistence(timeout: 3))
    app.buttons["plan.view.timeline"].tap(); XCTAssertTrue(app.staticTexts["plan.hero"].exists)
  }
}
```

各ビューに `.accessibilityIdentifier("…")` を付ける(上の ID 一覧)。`-uiTesting` ではアニメーションを切り、`TripStore` を一時ディレクトリに(Task 3 で配線済み)。

- [ ] **Step 4: アクセシビリティ仕上げ** — 日タブ `accessibilityAddTraits(.isTabBar)`/`.isSelected`、`DayTimeBar` の `accessibilityLabel`、ビルド完了・Undo・hard 違反の `AccessibilityNotification.Announcement`、全 `Button` に ≥44pt の `contentShape`、`@Environment(\.accessibilityReduceMotion)` で `withAnimation` を素通し。Dynamic Type `accessibility5` で `screenshot.sh a11y5`(`xcrun simctl ui booted content_size accessibility-extra-extra-extra-large`)を撮り、横スクロールと重なりが無いことを目視。

- [ ] **Step 5: verify-app.sh を test 対応に** — `ACTION=${1:-build}; EXTRA=(); [[ $ACTION == test ]] && EXTRA=(-only-testing:TripCheckTests -only-testing:TripCheckUITests)` を足し、`xcodebuild … -derivedDataPath build "$ACTION" "${EXTRA[@]}"`。README に手順と最終検証値(UI テスト 3/3、App 単体テスト 2、AppCore テスト N、Kit テスト本数の更新(`verify-kit.sh` はパッケージ全体を回す)、スクショ一覧)を記録。

- [ ] **Step 6: Commit** — `git commit -m "The phone app speaks both languages, reads aloud, and proves its first screen"`

---

## 自己レビュー記録

- **Spec 網羅**: §4.3 Apple 解決器 → Task 5、§5.1 状態 → Task 2、§5.2 入力 → Task 3/4、§5.3 画面 8 つ → Task 3(Start)/5(Resolve)/6(Build, Plan 骨格)/7(タイムライン)/9(Detail)/12(Share)/13(Print)/6(Error は `RootView` の `.error` 分岐)、§5.4 地図 → Task 8、§5.5 保存・ロケール → Task 11/14、§5.6 デザイン → Task 1、§5.7 a11y → Task 14、§6 エラー処理 → Task 5(unresolved)/6(issues)/11(storageUnavailable)/12(blocked)、§7 テスト → 各タスク + Task 14、§10 ファーストビュー契約 → Task 14 の `testFirstViewportContractAtDefaultType`。
- **2026-08-23 事前検証**: 本計画が名指しする Kit の識別子 156 件を `apple/Packages/TripCheckKit/Sources/TripCheckKit`(HEAD `4b07936`)に対して照合し、41 件の不一致(11 blocking / 26 important / 4 cosmetic)と 28 件の環境・計画内部の不整合を本文に反映した。拘束力のある判断は `.superpowers/sdd/2026-08-21-tripcheck-ios-app-plan/preflight-rulings.md`(R1〜R15)にある。主な帰結: `AppCopy`(AppCore)の新設、`BuildRunner` の順序(counterfactuals → derive)、`PlannerHistory(initial:limit:)`、`WishlistSerializer.formatPlaces` への委譲、`PlanWarningAction` と Kit `WarningAction` の写像、`PersistedTripInput`/`PersistedEdits` の DTO、`PreTripTimeline` の Kit 側移植、全テストの `@Test @MainActor … async` 化。
- **未決の小さな判断(実装者が決めてよい)**: Anton の TTF が取れないときのフォールバック(Task 1)、`MKPointOfInterestCategory` → Google 型文字列の写像の網羅範囲(Task 5、最低 15 種)、`EntryEditSheet`/`ConditionsSection` のラベルを `Copy` の既存鍵に寄せるか `AppCopy` に置くか(Task 4/5)。
- **Plan 2 の前提が崩れるケース**: Kit の公開 API が `4b07936` から変わったら、本計画の Interfaces を先に更新してから着手する。Kit に手を入れてよいのは Task 10 の `PreTripTimeline` と `CalendarDate.adding(months:)` だけ。
