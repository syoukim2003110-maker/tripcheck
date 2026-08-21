# TripCheck iOS アプリ(鍵ゼロ)実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TripCheckKit の上に SwiftUI の iPhone アプリを載せ、鍵ゼロ(サーバ・API キー・アカウントなし)で Start → Resolve → Build → Plan → Detail → 編集/Undo → 保存 → 共有/PDF までを動かす。

**Architecture:** `apple/Packages/TripCheckKit` に第 2 ターゲット **TripCheckAppCore**(`TripCheckKit` + `Observation` + `MapKit` に依存、UI なし)を足し、`PlannerStore`(状態 3 グループ・世代ガード付きビルド・ガード付き編集・Undo)と `ApplePlaceResolver`(MKLocalSearch)をそこに置いて `swift test` で検証する。`apple/TripCheck` は SwiftUI の薄い層(画面・部品・地図・デザイン)で、子ビューはイベント発火のみ。XcodeGen の `project.yml` が唯一の正。

**Tech Stack:** Swift 6.3 / SwiftUI(iOS 17+)/ Observation / MapKit(`Map`, `Annotation`, `MapPolyline`, `MKLocalSearch`, `MKLocalSearchCompleter`)/ `ShareLink` / `ImageRenderer`(PDF)/ XcodeGen 2.46(`~/.local/xcodegen/bin/xcodegen`)/ XCTest(UI テスト)/ `xcrun simctl`(iPhone 17 Pro シミュレータ)。

**Spec:** `docs/superpowers/specs/2026-08-21-tripcheck-swift-v1-design.md`(§4.3, §5, §6, §7)。**前提: Plan 1(`2026-08-21-tripcheck-kit-plan.md`)が完了し、そこで定義した型名(`TripRequest`, `PlannerContext`, `BuiltTripPlan`, `TripFitAssessment`, `FeasibilityResult`, `PlannerEditState`, `PlannerHistory`, `PlannerEdits`, `ResolutionPipeline`, `PlaceResolver`, `ShareCodec`, `ShareScope`, `TripStore`, `Copy`, `VerdictCopy`, `TimelinePresentation`, `TripPresentation`, `DayPalette`, `BannedTerms`, `GapDetection`, `Destinations`, `SwissSample`)が存在すること。**

## Global Constraints

- iOS 17.0 以上、iPhone のみ(`TARGETED_DEVICE_FAMILY: "1"`)、縦向きのみ。Bundle ID `com.muraoshoki.tripcheck`、Team `T8L5BPC2XJ`、`CODE_SIGN_STYLE: Automatic`、`SWIFT_VERSION: "6.0"`、`SWIFT_STRICT_CONCURRENCY: complete`
- `project.yml` だけをコミット(`*.xcodeproj` は `.gitignore` 済み)。生成: `cd apple && ~/.local/xcodegen/bin/xcodegen generate`
- ビルド/テスト: `cd apple && xcodebuild -project TripCheck.xcodeproj -scheme TripCheck -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -5`(`apple/tools/verify-app.sh` に集約)
- 子ビューは `@Environment(PlannerStore.self)` で**読むだけ**、書き込みは `store.<action>()` 経由。ビューに `@State` を置いてよいのは開閉・一時入力などローカルな UI 状態だけ
- `PlannerViewState` は `TripCheckAppCore` にだけ存在し、`TripCheckKit` の関数には渡さない(型で不可能)
- 文言は `Copy.for(locale)` / `VerdictCopy` / `TimelinePresentation` から取る。ビューに日本語・英語の文リテラルを直書きしない(例外: アクセシビリティ専用の短いラベルも `PlannerCopy` に足す)。`BannedTerms` を通す走査テストあり
- SF Symbols・絵文字は使わない。アイコンは `Design/Icons/` の 24 種(`Shape`)
- 色・タイポ・角丸は `Design/Tokens.swift` の定数のみ使う(`Color(hex:)` の直書き禁止)
- 本文 12pt 未満禁止(ラベル 11pt のみ許容)。`Font` は全て `Typography` 経由で `relativeTo:` 付き(Dynamic Type)
- `reduceMotion` でアニメーション停止。主要タップ標的 ≥44pt
- コミット規約は Plan 1 と同じ(散文体 + `Co-Authored-By` トレーラー)

---

## ファイル構成

```
apple/
├ project.yml
├ tools/verify-app.sh, tools/screenshot.sh
├ Packages/TripCheckKit/
│  ├ Package.swift                          ← TripCheckAppCore ターゲットと TripCheckAppCoreTests を追加
│  ├ Sources/TripCheckAppCore/
│  │  ├ State/TripRequestState.swift, PlanEditState+.swift(Kit の PlannerEditState を使う), PlannerViewState.swift
│  │  ├ State/WishlistEntry.swift          ← 構造化リスト(spec §5.2)と WishlistSerializer への変換
│  │  ├ Store/PlannerStore.swift, BuildRunner.swift, PlannerStore+Edits.swift, PlannerStore+Resolve.swift, PlannerStore+Persistence.swift, PlannerStore+Share.swift
│  │  ├ Providers/ApplePlaceResolver.swift, AppleSuggestions.swift
│  │  └ Model/BuiltPlanBundle.swift, PlanIssue.swift, Toast.swift
│  └ Tests/TripCheckAppCoreTests/…
└ TripCheck/
   ├ App/TripCheckApp.swift, RootView.swift
   ├ Design/Tokens.swift, Typography.swift, Icons/Icon.swift(+24 Shape), Fonts/Anton-Regular.ttf
   ├ Screens/Start/StartScreen.swift, PlaceSearchField.swift, WishlistRow.swift, EntryEditSheet.swift, PasteImportSheet.swift, DaysPicker.swift, RecentTripsSection.swift
   ├ Screens/Resolve/ResolveScreen.swift, ResolveRow.swift, ManualPinSheet.swift, ConditionsSection.swift, FlightsSection.swift
   ├ Screens/Build/BuildScreen.swift
   ├ Screens/Plan/PlanScreen.swift, HeroHeader.swift, DayTabs.swift, DayTimeBar.swift, TimelineList.swift, ActivityCard.swift, MovementCard.swift, MealRow.swift, HotelLegRow.swift, IssueCard.swift, VerdictDetails.swift, BeforeYouGoCard.swift, DaySettingsSheet.swift
   ├ Screens/Detail/StopInspector.swift, EvidenceDisclosure.swift
   ├ Screens/Share/ShareSheet.swift
   ├ Screens/Print/TripPrintSheet.swift, PDFExporter.swift
   ├ Map/TripMapView.swift, PinView.swift, MapLegend.swift
   ├ Components/Toast.swift, DisclosureCard.swift, SegmentedPills.swift
   └ Resources/Assets.xcassets, Info.plist
TripCheckUITests/PlannerFlowTests.swift
```

---

### Task 1: XcodeGen プロジェクト・デザイントークン・アイコン・空のアプリがシミュレータで起動する

**Files:**
- Create: `apple/project.yml`, `apple/TripCheck/App/TripCheckApp.swift`, `apple/TripCheck/App/RootView.swift`, `apple/TripCheck/Design/Tokens.swift`, `apple/TripCheck/Design/Typography.swift`, `apple/TripCheck/Design/Icons/Icon.swift`, `apple/TripCheck/Resources/Info.plist`, `apple/TripCheck/Resources/Assets.xcassets/AppIcon.appiconset/Contents.json`(空のセット), `apple/tools/verify-app.sh`, `apple/tools/screenshot.sh`
- Fonts: `apple/TripCheck/Design/Fonts/Anton-Regular.ttf`(`node_modules/@fontsource/anton/files/anton-latin-400-normal.woff2` は woff2 なので使えない。OFL の TTF を https://github.com/google/fonts/tree/main/ofl/anton から取得。取得できなければ `Typography.display` は `.system(.largeTitle, design: .default).weight(.black)` にフォールバックし、README に記録)

**Interfaces:**
- Produces: `Tokens.Color.{bg, panel, ink, ink2, muted, line, controlBorder, tile, tileDeep, accent, accentDeep, accentSoft, good, goodSoft, warnBg, warnBorder, warnInk, danger, focus}`、`Tokens.Radius.{control = 10, card = 14, pill = 999}`、`Tokens.Day.color(index:) -> Color`(Kit の `DayPalette`)、`Typography.{hero, screenTitle, stats, dayHeader, stopName, body, meta, label, display}`(`Font`)、`enum Icon: String, CaseIterable { arrow, bed, calendar, car, check, close, cloud, external, fog, fork, mark, moon, rain, pin, plus, search, signal, snow, spark, storm, sun, taxi, train, walk }` と `IconView(_ icon: Icon, size: CGFloat = 20, color: Color)`

- [ ] **Step 1: project.yml**

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
      testTargets: [TripCheckUITests]
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

- [ ] **Step 2: TripCheckAppCore ターゲットを Package.swift に追加**(中身は Task 2 で)

```swift
// Package.swift の targets に追加
.target(name: "TripCheckAppCore", dependencies: ["TripCheckKit"], swiftSettings: [.swiftLanguageMode(.v6)]),
.testTarget(name: "TripCheckAppCoreTests", dependencies: ["TripCheckAppCore"], swiftSettings: [.swiftLanguageMode(.v6)]),
// products に追加
.library(name: "TripCheckAppCore", targets: ["TripCheckAppCore"]),
```

`Sources/TripCheckAppCore/AppCore.swift` に `public enum TripCheckAppCore { public static let name = "AppCore" }`、`Tests/TripCheckAppCoreTests/SmokeTests.swift` に 1 テスト。

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
// Design/Icons/Icon.swift — 24 種。各アイコンは app/PlannerIcons.tsx の SVG path を Path に移植(24×24、stroke 1.8、round cap/join)
enum Icon: String, CaseIterable { case arrow, bed, calendar, car, check, close, cloud, external, fog, fork, mark, moon, rain, pin, plus, search, signal, snow, spark, storm, sun, taxi, train, walk }
struct IconView: View {
  let icon: Icon; var size: CGFloat = 20; var color: Color = Tokens.Color.ink
  var body: some View {
    IconShape(icon: icon).stroke(color, style: StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
      .frame(width: size, height: size).accessibilityHidden(true)
  }
}
struct IconShape: Shape {
  let icon: Icon
  func path(in rect: CGRect) -> Path {
    var p = Path(); let s = rect.width / 24
    switch icon {
    case .check: p.move(to: CGPoint(x: 5*s, y: 12.5*s)); p.addLine(to: CGPoint(x: 10*s, y: 17*s)); p.addLine(to: CGPoint(x: 19*s, y: 7*s))
    case .close: p.move(to: CGPoint(x: 6*s, y: 6*s)); p.addLine(to: CGPoint(x: 18*s, y: 18*s)); p.move(to: CGPoint(x: 18*s, y: 6*s)); p.addLine(to: CGPoint(x: 6*s, y: 18*s))
    // 残り 22 種: app/PlannerIcons.tsx の <path d="…"> を座標ごとに移す(M/L/C/A を move/addLine/addCurve/addArc に)
    default: break
    }
    return p
  }
}
```

`app/PlannerIcons.tsx` を開き、24 種全部の `d` 属性を移す(`A`(弧)は `addArc` か 3 次ベジェ近似)。全部埋まったことは Task 15 の `IconShape` 走査テストで固定する(各 `Icon` の path が空でない)。

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
# apple/tools/verify-app.sh — xcodegen → build (→ test)
set -u; cd "$(dirname "$0")/.."
~/.local/xcodegen/bin/xcodegen generate > /dev/null || exit 1
DEST='platform=iOS Simulator,name=iPhone 17 Pro'
LOG=${TMPDIR:-/tmp}/tripcheck-app-build.log
xcodebuild -project TripCheck.xcodeproj -scheme TripCheck -destination "$DEST" ${1:-build} > "$LOG" 2>&1; CODE=$?
grep -E "error:|warning: .*deprecated|BUILD|TEST" "$LOG" | tail -20; echo "exit=$CODE log=$LOG"; exit $CODE
```

```bash
#!/bin/zsh
# apple/tools/screenshot.sh <name> — 起動中のシミュレータをスクショ
set -u; OUT=${SCRATCHPAD:-/tmp}/tripcheck-$1.png
xcrun simctl io booted screenshot "$OUT" && echo "$OUT"
```

- [ ] **Step 6: ビルドして起動**

Run: `chmod +x apple/tools/*.sh && apple/tools/verify-app.sh && xcrun simctl install booted apple/build/… `(xcodebuild の `-derivedDataPath apple/build` を verify-app.sh に足し、`xcrun simctl install booted apple/build/Build/Products/Debug-iphonesimulator/TripCheck.app && xcrun simctl launch booted com.muraoshoki.tripcheck`)
Expected: `BUILD SUCCEEDED`、シミュレータに「TripCheck」の文字。`apple/tools/screenshot.sh boot` で PNG を確認。

- [ ] **Step 7: Commit** — `git add apple/ && git commit -m "An empty TripCheck opens on the phone with its colours and icons ready"`

---

### Task 2: 状態 3 グループ・WishlistEntry・PlannerStore の骨格・世代ガード付きビルド

**Files:**
- Create: `Sources/TripCheckAppCore/State/{TripRequestState,PlannerViewState,WishlistEntry}.swift`, `Sources/TripCheckAppCore/Store/{PlannerStore,BuildRunner}.swift`, `Sources/TripCheckAppCore/Model/BuiltPlanBundle.swift`
- Test: `Tests/TripCheckAppCoreTests/{WishlistEntryTests,PlannerStoreBuildTests}.swift`

**Interfaces:**
- Produces:
```swift
public struct WishlistEntry: Identifiable, Hashable, Codable, Sendable {
  public var id: UUID; public var text: String; public var priority: WishlistPriority; public var fixedDay: Int?; public var fixedTime: String?; public var timeOfDay: WishlistTimeOfDay?; public var isReservation: Bool; public var stayMinutes: Int?
  public var pinned: PinnedResolution?           // .apple(providerRef: String, stop: ResolvedStop) | .manual(ResolvedStop) | .catalog(ResolvedStop)
  public var parsed: ParsedWishlistPlace { get }  // Kit 型へ
}
public enum WishlistSerialization { public static func raw(from entries: [WishlistEntry], headings: [Int: String]?, locale: PlannerLocale) -> String; public static func entries(fromPasted raw: String) -> (entries: [WishlistEntry], unparsed: [String], mode: InputMode, lockedOrderByDay: [Int: [String]]) }
public struct TripRequestState: Equatable, Sendable { entries: [WishlistEntry], unparsedLines: [String], inputMode: InputMode, tripDays: Int? (nil = 未定), tripStartDate: String?, destination: DestinationChoice, pace: Pace, travelPreference: TravelPreference, dayStartDefault: String, dayEndTarget: String?, transferBufferMinutes: Int, maxWalkingMinutesPerLeg: Int?, maxTransfersPerLeg: Int?, hotelQuery: String, arrivalAirport: String, arrivalTime: String, departureAirport: String, departureTime: String, flightKind: FlightKind, mealPlan: MealPlan, locale: PlannerLocale, resolutions: [UUID: PlaceResolution], mixedCountryCodes: [String], buildMode: automatic|custom }
public enum Screen: Equatable { case start, resolve, building, plan, error(String) }
public struct PlannerViewState: Equatable, Sendable { screen: Screen, selectedDay: Int, mobileView: timeline|map, inspector: Inspector?, sheetDetent: peek|half|full, shareOpen: Bool, printOpen: Bool, pendingHardEdit: PendingHardEdit?, toast: Toast?, mapScope: all|day, mapFocusedStopId: String?, verdictExpanded: Bool, pasteOpen: Bool, editingEntry: UUID?, announcement: String? }
public struct BuiltPlanBundle: Sendable { request: TripRequest, plan: BuiltTripPlan, fit: TripFitAssessment, evidence: PlannerEvidenceSnapshot, result: FeasibilityResult, counterfactuals: [TripCounterfactual], gaps: [Int: ItineraryGap], builtAt: Date }
@Observable @MainActor public final class PlannerStore {
  public var request: TripRequestState; public var edit: PlannerEditState; public var view: PlannerViewState
  public private(set) var bundle: BuiltPlanBundle?; public private(set) var history: PlannerHistory<PlannerEditState>
  public init(resolvers: [any PlaceResolver], store: TripStore?, clock: any Clock<Duration> = ContinuousClock())
  public func tripRequest() -> TripRequest      // request + edit → TripRequest(view は見ない)
  public func build() async                     // 世代ガード
  public func cancelBuild(); public func reset()
  public var buildGeneration: Int { get }
}
public enum BuildRunner { public static func run(_ request: TripRequest) -> BuiltPlanBundle }   // 純関数。Kit の 4 段 + counterfactuals + gaps
```

- [ ] **Step 1: 失敗するテストを書く**

```swift
import Testing
@testable import TripCheckAppCore
import TripCheckKit

@Test func entriesSerialiseToWebCompatibleTextAndBack() {
  let e = [WishlistEntry(text: "Ghibli Museum", priority: .must, fixedDay: 2, fixedTime: "10:00", isReservation: true, stayMinutes: 120),
           WishlistEntry(text: "Ueno Park", priority: .optional)]
  let raw = WishlistSerialization.raw(from: e, headings: nil, locale: .en)
  #expect(raw == "Ghibli Museum — Day 2 10:00 booked · must · stay 120 min\nUeno Park — optional")
  let back = WishlistSerialization.entries(fromPasted: raw)
  #expect(back.entries.map(\.text) == ["Ghibli Museum", "Ueno Park"]); #expect(back.entries[0].isReservation); #expect(back.mode == .wishlist)
}

@Test func pastedItineraryWithHeadingsBecomesCheckerMode() {
  let r = WishlistSerialization.entries(fromPasted: "Day 1\nUeno Park\nSenso-ji\nDay 2\nTokyo Tower\n???")
  #expect(r.mode == .existing_itinerary)
  #expect(r.lockedOrderByDay[0]?.count == 2)
  #expect(r.unparsed == ["???"])
}

@Test func tripRequestNeverReadsViewState() {
  // コンパイル時の保証に加えて、view を変えても TripRequest が同一であること
  let store = PlannerStore(resolvers: [], store: nil)
  store.loadSample(.switzerland)
  let a = store.tripRequest()
  store.view.selectedDay = 3; store.view.mobileView = .map; store.view.verdictExpanded = true
  #expect(store.tripRequest() == a)
}

@Test func staleBuildsAreDropped() async {
  let store = PlannerStore(resolvers: [], store: nil)
  store.loadSample(.switzerland)
  async let first: Void = store.build()
  store.request.tripDays = 2          // 変更 → 世代が進む
  await store.build()
  await first
  #expect(store.bundle?.request.days == 2)
  #expect(store.view.screen == .plan)
}

@Test func sampleBuildsWithZeroKeys() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland)
  await store.build()
  #expect(store.bundle?.plan.days.count == 4)
  #expect(store.bundle?.plan.days.allSatisfy { !$0.stops.isEmpty } == true)
  #expect(store.view.screen == .plan)
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
  public private(set) var history: PlannerHistory<PlannerEditState>
  public private(set) var buildGeneration = 0
  let resolvers: [any PlaceResolver]; let store: TripStore?
  private var buildTask: Task<Void, Never>?

  public func tripRequest() -> TripRequest {
    let raw = WishlistSerialization.raw(from: request.entries, headings: nil, locale: request.locale)
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
    return TripRequest(raw: raw, days: edit.tripDays, pace: edit.pace, locale: request.locale, context: ctx)
  }

  public func build() async {
    buildTask?.cancel()
    buildGeneration += 1; let generation = buildGeneration
    view.screen = .building
    let req = tripRequest()
    let days = request.tripDays
    let task = Task.detached(priority: .userInitiated) { () -> BuiltPlanBundle in
      if days == nil {   // 日数未定: (日数, 拠点) の不動点
        let fixed = ProvisionalTripLength.resolve(request: req, recommendBase: { plan in plan.baseRecommendations.first.map { ResolvedStop(base: $0.base) } })
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

`BuildRunner.run` は `TripBuilder.build → TripScenarios.assessTripFit → Feasibility.snapshot(options: EvidenceSnapshotOptions(dateWasProvided: ctx.tripStartDate != nil, baseWasProvided: ctx.resolvedBase != nil, dayEndWasProvided: ctx.dayEndTarget != nil, userDurationStopIds: ctx.durationOverrides?.keys, capturedAt: ISO8601(now), transferBufferMinutes:, dayStartTimes:, dayEndTimes:)) → Feasibility.derive → TripScenarios.counterfactuals → GapDetection.primaryGap(各日)`。

`loadSample(_ id: DestinationId)`: `Destinations.byId(id).sample` の ja/en 文字列を `WishlistSerialization.entries(fromPasted:)` に通し、`SwissSample.resolvedStops(locale:)` を各 entry の `pinned = .catalog(stop)` に(名前一致)。`request.tripDays = 4`、`destination = .destination(.switzerland)`。

- [ ] **Step 4: 緑を確認** → **Step 5: Commit** — `git commit -m "The store holds the trip in three boxes and builds it without racing itself"`

---

### Task 3: Start 画面 — 場所リスト・検索フィールド(Apple 候補)・日数・国・CTA・サンプル

**Files:**
- Create: `Sources/TripCheckAppCore/Providers/AppleSuggestions.swift`, `apple/TripCheck/Screens/Start/{StartScreen,PlaceSearchField,WishlistRow,DaysPicker}.swift`, `apple/TripCheck/Components/{SegmentedPills,DisclosureCard}.swift`
- Modify: `apple/TripCheck/App/RootView.swift`(`switch store.view.screen`)
- Test: `Tests/TripCheckAppCoreTests/AppleSuggestionsTests.swift`(デバウンス・キャッシュ・2 文字未満)

**Interfaces:**
- Produces: `@Observable @MainActor public final class AppleSuggestions { public var query: String; public private(set) var results: [PlaceSuggestion]; public private(set) var state: idle|loading|ready|unavailable; public init(debounce: Duration = .milliseconds(550), completer: any SuggestionCompleting = MKLocalSearchCompleterAdapter()); public func setRegion(_ bounds: GeoBounds?) }`、`PlaceSuggestion { title, subtitle, completion: Sendable token }`、`protocol SuggestionCompleting`(テスト用フェイク可)、`PlannerStore.addEntry(text:, suggestion: PlaceSuggestion?) async`(候補を選んだ場合は `ApplePlaceResolver.resolve(completion:)` で `pinned = .apple`)、`PlannerStore.removeEntry(id:)`、`PlannerStore.canAddEntry: Bool`(<12)、`PlannerStore.startCTA: (label: String, enabled: Bool)`、`PlannerStore.requestBuildFromStart() async`(解決 → クリーンなら build、曖昧/未解決があれば `.resolve` へ)

- [ ] **Step 1: 失敗するテストを書く**

```swift
@Test func suggestionsWaitForTwoCharsAndDebounce() async throws {
  let fake = FakeCompleter()
  let s = AppleSuggestions(debounce: .milliseconds(10), completer: fake)
  s.query = "S"; try await Task.sleep(for: .milliseconds(30)); #expect(fake.calls == 0)
  s.query = "Se"; try await Task.sleep(for: .milliseconds(30)); #expect(fake.calls == 1)
  s.query = "Sen"; s.query = "Sens"; try await Task.sleep(for: .milliseconds(30)); #expect(fake.calls == 2)   // 途中は潰れる
}

@Test func thirteenthEntryIsRefused() async {
  let store = PlannerStore(resolvers: [], store: nil)
  for i in 0..<12 { await store.addEntry(text: "Place \(i)", suggestion: nil) }
  #expect(!store.canAddEntry)
  await store.addEntry(text: "Place 12", suggestion: nil)
  #expect(store.request.entries.count == 12)
  #expect(store.view.toast?.kind == .limit)
}

@Test func startCtaNeedsPlacesAndGoesToResolveWhenAmbiguous() async {
  let store = PlannerStore(resolvers: [FakeResolver(review: ["Bern"])], store: nil)
  #expect(store.startCTA.enabled == false)
  await store.addEntry(text: "Bern", suggestion: nil); store.request.tripDays = 2
  #expect(store.startCTA.enabled)
  await store.requestBuildFromStart()
  #expect(store.view.screen == .resolve)
}
```

- [ ] **Step 2: 失敗を確認**

- [ ] **Step 3: 実装(AppCore)** — `AppleSuggestions`: `query` の `didSet` でタスクをキャンセルして再スケジュール(`Task.sleep(debounce)` → 2 文字未満なら `results = []`、それ以外 `completer.complete(query, region)`)。キャッシュ `(query, region)` → 結果、60 件 FIFO。`MKLocalSearchCompleterAdapter` は `MKLocalSearchCompleter` を `delegate` 経由で `CheckedContinuation` に橋渡し(`@MainActor`)。`requestBuildFromStart`: `ResolutionPipeline.resolve(queries, destination:, locale:, resolvers:)` を未固定の entry にだけ走らせ、`review`/`unresolved` が 1 件でもあれば `view.screen = .resolve`、全部 `confirmed` かつ `mixedCountryCodes.isEmpty` なら `await build()`。

- [ ] **Step 4: 実装(UI)**

```swift
// Screens/Start/StartScreen.swift(抜粋)
struct StartScreen: View {
  @Environment(PlannerStore.self) private var store
  @State private var suggestions = AppleSuggestions()
  var body: some View {
    let text = Copy.for(store.request.locale)
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        Text(text.startTitle).font(Typography.screenTitle).foregroundStyle(Tokens.Color.ink)
        PlaceSearchField(suggestions: suggestions, onSubmit: { t, s in Task { await store.addEntry(text: t, suggestion: s) } })
          .disabled(!store.canAddEntry)
        Text(text.startHelpShort).font(Typography.body).foregroundStyle(Tokens.Color.muted)
        ForEach(store.request.entries) { entry in
          WishlistRow(entry: entry, locale: store.request.locale,
                      onPriority: { store.setPriority(id: entry.id, $0) },
                      onEdit: { store.view.editingEntry = entry.id },
                      onRemove: { store.removeEntry(id: entry.id) })
        }
        Button(text.pasteText) { store.view.pasteOpen = true }.buttonStyle(.secondaryPill)
        DaysPicker(days: Binding(get: { store.request.tripDays }, set: { store.request.tripDays = $0 }), locale: store.request.locale)
        DisclosureCard(title: text.dateDisclosure) { DatePickerRow(date: $store.request.tripStartDate, locale: store.request.locale) }
        DestinationPicker(choice: Binding(get: { store.request.destination }, set: { store.setDestination($0); suggestions.setRegion(store.destinationBounds) }), locale: store.request.locale)
        DisclosureCard(title: text.customDisclosure) { CustomOptions() }
        Button(text.seeExample) { store.loadSample(.switzerland); Task { await store.build() } }.buttonStyle(.secondaryPill)
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

`PlaceSearchField`: `TextField` + 下に `results` を `List` 風に最大 5 件(各行 ≥44pt、`accessibilityLabel` = title + subtitle)。Return で候補なし追加。`WishlistRow`: 名前(`stopName`)・✓(pinned)・`SegmentedPills`(通常/必須/任意)・チップ(日/時刻/予約/滞在)・スワイプ削除・タップで編集。`DaysPicker`: 3/4/5/未定のタイル + 「他の日数」`Picker`(1–14)。`DestinationPicker`: `Picker`(auto + 25 + worldwide、`Destinations.options(locale:)`)。

- [ ] **Step 5: ビルド・目視** — `apple/tools/verify-app.sh` → 起動 → `screenshot.sh start`。確認: CTA が初見で見える、12 件で追加が止まる、サンプルで Plan へ遷移(Plan 画面は Task 6 までプレースホルダ `Text("plan")`)。

- [ ] **Step 6: Commit** — `git commit -m "Travellers type places one at a time, and the phone finds them as they type"`

---

### Task 4: 行編集シートと貼り付け取込

**Files:**
- Create: `apple/TripCheck/Screens/Start/{EntryEditSheet,PasteImportSheet}.swift`
- Modify: `Sources/TripCheckAppCore/Store/PlannerStore.swift`(`updateEntry(id:, patch:)`, `importPasted(_:)`)
- Test: `Tests/TripCheckAppCoreTests/PasteImportTests.swift`

**Interfaces:**
- Produces: `PlannerStore.updateEntry(id: UUID, priority:, fixedTime: String??, isReservation:, stayMinutes: Int??, fixedDay: Int??)`、`PlannerStore.importPasted(_ raw: String) -> (added: Int, unparsed: Int)`(既存 entries に**追加**、12 件超は入れず `toast(.limit)`、見出しがあれば `inputMode = .existing_itinerary` と `edit.lockedOrderByDay`)

- [ ] **Step 1: テスト**

```swift
@Test func pasteAppendsUpToTwelveAndKeepsUnparsed() {
  let store = PlannerStore(resolvers: [], store: nil)
  let r = store.importPasted((0..<14).map { "Place \($0)" }.joined(separator: "\n") + "\nhttps://x.example\n")
  #expect(r.added == 12); #expect(store.request.entries.count == 12)
  #expect(store.view.toast?.kind == .limit)
}

@Test func entryPatchDistinguishesClearFromKeep() {
  let store = PlannerStore(resolvers: [], store: nil)
  let id = store.addEntrySync(text: "Tokyo Tower")
  store.updateEntry(id: id, priority: nil, fixedTime: .some("14:30"), isReservation: nil, stayMinutes: nil, fixedDay: nil)
  #expect(store.request.entries[0].fixedTime == "14:30")
  store.updateEntry(id: id, priority: .optional, fixedTime: nil, isReservation: nil, stayMinutes: nil, fixedDay: nil)
  #expect(store.request.entries[0].fixedTime == "14:30")
  store.updateEntry(id: id, priority: nil, fixedTime: .some(nil), isReservation: nil, stayMinutes: nil, fixedDay: nil)
  #expect(store.request.entries[0].fixedTime == nil)
}
```

- [ ] **Step 2: 失敗を確認** → **Step 3: 実装** — `EntryEditSheet`: `DatePicker(.hourAndMinute)` を `ClockTime` 文字列に、`Toggle`「予約済み」、滞在 `Stepper`(15–480、15 刻み)/`Picker`、日 `Picker`(なし/1…tripDays)、「この場所を外す」は最後。`PasteImportSheet`: `TextEditor` + 「読み取る」→ プレビュー(解析行 N / 読み取れない行 M)→ 「追加」。

- [ ] **Step 4: ビルド・目視** → **Step 5: Commit** — `git commit -m "A pasted note or an old itinerary turns into the same place list"`

---

### Task 5: ApplePlaceResolver と Resolve 画面(候補選択・3 件ずつ・手動ピン・条件・フライト)

**Files:**
- Create: `Sources/TripCheckAppCore/Providers/ApplePlaceResolver.swift`, `Sources/TripCheckAppCore/Store/PlannerStore+Resolve.swift`, `apple/TripCheck/Screens/Resolve/{ResolveScreen,ResolveRow,ManualPinSheet,ConditionsSection,FlightsSection}.swift`
- Test: `Tests/TripCheckAppCoreTests/{ApplePlaceResolverTests,ResolveFlowTests}.swift`

**Interfaces:**
- Produces: `public struct ApplePlaceResolver: PlaceResolver { public init(search: any LocalSearching = MKLocalSearchAdapter(), timeout: Duration = .seconds(6), concurrency: Int = 4) }`、`protocol LocalSearching { func search(query: String, region: GeoBounds?, locale: PlannerLocale) async throws -> [LocalSearchHit] }`、`LocalSearchHit { name, address: String?, latitude, longitude, countryCode: String?, category: String? }`、`PlannerStore.chooseCandidate(entryId:, candidate: PlaceCandidate)`、`PlannerStore.rejectCandidates(entryId:)`、`PlannerStore.setManualPin(entryId:, name:, address:, latitude:, longitude:)`、`PlannerStore.retryResolve(entryId:) async`、`PlannerStore.continueFromResolve() async`(must/予約が未解決なら `pendingHardEdit = .mustUnresolved` で確認)、`PlannerStore.resolveRows: [ResolveRowModel]`(状態・候補・順位・抑止フラグ)、`PlannerStore.canContinue: Bool`

- [ ] **Step 1: テスト**

```swift
@Test func appleHitsBecomeEstimatedCandidatesNeverVerified() async {
  let fake = FakeSearch(hits: ["Bern": [.init(name: "Bern", address: "Bern, Switzerland", latitude: 46.948, longitude: 7.447, countryCode: "CH", category: "city"),
                                        .init(name: "Universität Bern", address: "Bern", latitude: 46.95, longitude: 7.44, countryCode: "CH", category: "university")]])
  let r = await ApplePlaceResolver(search: fake).resolve([PlaceQuery(inputIndex: 0, input: "Bern", pinnedProviderRef: nil)], destination: .auto, locale: .en)
  guard case .review(let c) = r[0] else { Issue.record("expected review (2 candidates)"); return }
  #expect(c.count == 2); #expect(c.allSatisfy { $0.stop.provider == .apple })
  #expect(c[0].stop.confidence == .medium)
  #expect(c.allSatisfy { $0.stop.verifiedAt.isEmpty || $0.stop.userProvidedCoordinates != true })
}

@Test func exactAppleMatchIsConfirmedDirectly() async {
  let fake = FakeSearch(hits: ["Senso-ji": [.init(name: "Senso-ji", address: "Asakusa", latitude: 35.7148, longitude: 139.7967, countryCode: "JP", category: "temple")]])
  let r = await ApplePlaceResolver(search: fake).resolve([PlaceQuery(inputIndex: 0, input: "senso-ji", pinnedProviderRef: nil)], destination: .auto, locale: .en)
  guard case .confirmed(let s) = r[0] else { Issue.record("expected confirmed"); return }
  #expect(s.countryCode == "JP")
}

@Test func timeoutYieldsUnresolvedNotCrash() async {
  let r = await ApplePlaceResolver(search: HangingSearch(), timeout: .milliseconds(20)).resolve([PlaceQuery(inputIndex: 0, input: "X", pinnedProviderRef: nil)], destination: .auto, locale: .en)
  guard case .unresolved = r[0] else { Issue.record("expected unresolved"); return }
}

@Test func resolveRowsGateFourthAttentionItem() async {
  let store = PlannerStore(resolvers: [FakeResolver(review: ["A", "B", "C", "D"])], store: nil)
  for n in ["A", "B", "C", "D", "E"] { await store.addEntry(text: n, suggestion: nil) }
  store.request.tripDays = 2
  await store.requestBuildFromStart()
  let rows = store.resolveRows
  #expect(rows.filter { $0.state == .review }.count == 4)
  #expect(rows.filter { $0.suppressed }.count == 1)
  #expect(!store.canContinue)
}

@Test func manualPinIsUserProvidedAndUnblocks() async {
  let store = PlannerStore(resolvers: [FakeResolver(unresolved: ["Nowhere"])], store: nil)
  await store.addEntry(text: "Nowhere", suggestion: nil); store.request.tripDays = 1
  await store.requestBuildFromStart()
  store.setManualPin(entryId: store.request.entries[0].id, name: "Nowhere", address: "", latitude: 1, longitude: 2)
  #expect(store.request.entries[0].pinned?.stop.userProvidedCoordinates == true)
  #expect(store.canContinue)
}
```

- [ ] **Step 2: 失敗を確認**

- [ ] **Step 3: 実装(AppCore)** — `ApplePlaceResolver.resolve`: `withTaskGroup` で同時 4、各クエリを `withTimeout(timeout)`(`Task.select` 相当を `async let` + `Task.sleep` で)。ヒットを `PlaceCandidate`(`ResolvedStop(id: "apple-\(inputIndex)-\(hash)", providerRef: nil, name, area: address の市区, latitude, longitude, sourceUrl: "", verifiedAt: "", confidence: .medium, planningDurationMinutes: StayEstimates.estimateStayMinutes(name:placeTypes: [category]), isAnchor: true, input:, inputIndex:, address:, countryCode:, provider: .apple)`、`isTouristic = !ResolutionPipeline.isNonTouristic(...)`)に変換 → 上位 3 → `ResolutionPipeline.autoAccept` で `confirmed` か `review`。0 件 → `unresolved`。`MKLocalSearchAdapter`: `MKLocalSearch.Request(naturalLanguageQuery:)`、`region = MKCoordinateRegion(bounds)`、`resultTypes = [.pointOfInterest, .address]`、`placemark.isoCountryCode`、`pointOfInterestCategory?.rawValue`。`PlannerStore+Resolve`: `resolutions[entryId]` の更新、`resolveRows` は `ResolutionPipeline.attentionRanks` で順位付けし rank ≥3 を `suppressed`、`mixedCountryCodes` を `ResolutionPipeline.mixedCountryCodes(pinned stops)` から。

- [ ] **Step 4: 実装(UI)** — `ResolveScreen`: 見出し(全確認時「N か所を確認しました」)、混在国の警告を**上**に(国 `Picker` + worldwide ボタン)、`ResolveRow`(状態アイコン `check/mark/search/close`、候補 ≤3 を `Button` で、4 件目以降 `Picker`、「候補にない(住所で指定)」、抑止文、未発見の 3 ボタン、行の「外す」)、`ManualPinSheet`(住所 `TextField` + 小さな `Map` をタップで座標 + 緯度経度 `TextField(inputMode: .decimal)` + 「この地点を使う」)、`ConditionsSection`(日数・日付・ホテル・ペース・移動・一日の開始/終了・乗換バッファ・徒歩上限・乗換上限)、`FlightsSection`(空港 `Picker` は国未確定なら全空港、時刻、便種別、`AirportComparisonView`)、下部 CTA「N か所で続ける」。

- [ ] **Step 5: ビルド・目視**(シミュレータは Apple 検索が実際に動く。「ベルン」「Bern」「Nowhere xyz123」で 3 状態を確認) → **Step 6: Commit** — `git commit -m "Ambiguous places get a choice, lost places get a pin, and nothing pretends to be verified"`

---
### Task 6: Build 画面と Plan 画面の骨格(ヒーロー・警告 1 件・日タブ・日ヘッダー・時間バー・統計行)

**Files:**
- Create: `apple/TripCheck/Screens/Build/BuildScreen.swift`, `apple/TripCheck/Screens/Plan/{PlanScreen,HeroHeader,DayTabs,DayTimeBar}.swift`, `Sources/TripCheckAppCore/Model/PlanIssue.swift`, `Sources/TripCheckAppCore/Store/PlannerStore+ViewModel.swift`
- Test: `Tests/TripCheckAppCoreTests/PlanViewModelTests.swift`

**Interfaces:**
- Produces(AppCore、導出値は全部ここ。ビューは計算しない):
  `PlannerStore.hero: (text: String, icon: Icon名 String)`、`PlannerStore.primaryWarning: (text: String, action: WarningAction)?`(`WarningAction: fixInput | chooseCountry | chooseCandidate | openAlternatives | openStop(id) | removeOptional | retryBuild`)、`PlannerStore.statsLine: String`、`PlannerStore.dayTabs: [DayTabModel { index, label, colorHex, density: String, isHoliday: Bool }]`、`PlannerStore.dayHeader(index) -> (summary: String, bar: DayTimeBarModel { visit, travel, slack: Double(割合), markers: [Marker(kind: reservation|conflict, position)], a11y: String })`、`PlannerStore.issues: [PlanIssue { kind, text, action }]`、`PlannerStore.spareCapacityLine(day) -> String?`、`PlannerStore.selectDay(_:)`

- [ ] **Step 1: テスト**

```swift
@Test func dayTimeBarSumsToOne() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  for i in 0..<4 { let b = store.dayHeader(i).bar; #expect(abs(b.visit + b.travel + b.slack - 1) < 1e-9) }
}

@Test func heroAndWarningPassBannedTerms() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  #expect(BannedTerms.violations(in: store.hero.text).isEmpty)
  if let w = store.primaryWarning { #expect(BannedTerms.violations(in: w.text).isEmpty) }
  #expect(store.statsLine.contains("8"))
}

@Test func onlyOneWarningAndItNamesTheTarget() async {
  let store = PlannerStore(resolvers: [FakeResolver(unresolved: ["Nowhere"])], store: nil)
  store.loadSample(.switzerland); await store.addEntry(text: "Nowhere", suggestion: nil)
  await store.requestBuildFromStart(); await store.continueFromResolve(force: true)
  #expect(store.primaryWarning?.text.contains("Nowhere") == true)
  #expect(store.primaryWarning?.action == .fixInput)
}
```

- [ ] **Step 2: 失敗を確認** → **Step 3: 実装(AppCore)** — `hero` は `VerdictCopy.hero` + 状態→アイコン(`VERIFIED→check / PROVISIONAL→signal / IF_ASSUMPTIONS→spark / INFEASIBLE→close / UNKNOWN→search`)。`primaryWarning` は `VerdictCopy.primaryWarning`(未解決入力 > 国の衝突 > 曖昧 > 後回しの Anchor > 営業時間不明 > 計算上限 > 主衝突 > 主注意、**1 件だけ**)。`dayHeader(i).bar` は `fit.days[i]` の `plannedMinutes` を visit/travel に分け、`slack = max(0, available − planned)`、合計で正規化。`issues` は種類ごとに 1 行(統合仕様 §5.5 の 8 種のうち鍵ゼロで起こる 6 種)。

- [ ] **Step 4: 実装(UI)**

```swift
// Screens/Plan/PlanScreen.swift(骨格)
struct PlanScreen: View {
  @Environment(PlannerStore.self) private var store
  var body: some View {
    VStack(spacing: 0) {
      if store.view.mobileView == .timeline {
        ScrollView {
          VStack(alignment: .leading, spacing: 12) {
            HeroHeader()                                   // 1. 成立するか
            if let w = store.primaryWarning { WarningLine(warning: w) }   // 2. 警告 1 件
            DayTabs()                                      // 3. 日タブ + 日ヘッダー + 時間バー
            DayHeaderRow(index: store.view.selectedDay)
            TimelineList(dayIndex: store.view.selectedDay) // 4. 停留所(Task 7)
            if let spare = store.spareCapacityLine(store.view.selectedDay) { SpareLine(text: spare) }   // 5.
            Text(store.statsLine).font(Typography.stats)
            IssueCard(); VerdictDetails(); BeforeYouGoCard()          // Task 10
          }.padding(16)
        }
      } else { TripMapView() }                             // Task 8
    }
    .background(Tokens.Color.bg)
    .safeAreaInset(edge: .bottom) { SegmentedPills(selection: $store.view.mobileView, items: [(.timeline, text.timelineTab), (.map, text.mapTab)]).padding(.bottom, 8) }
    .toolbar { PlanToolbar() }                             // 編集 / ••• / 言語
  }
}
```

`DayTabs`: `ScrollView(.horizontal)` の `Button` 群、選択はデイカラー塗り・非選択は輪郭、`accessibilityAddTraits(.isTabBar)` を親に、各タブ `.isSelected`、`accessibilityValue` に `density`。`DayTimeBar`: `GeometryReader` で 3 区間(visit=ink / travel=accent / slack=斜線 `Pattern` は `Canvas` で描く)+ マーカー、全体を 1 要素に `accessibilityLabel(bar.a11y)`。`BuildScreen`: `ProgressView` + 3 ステージの `VStack`(現在を太字)+ キャンセル。

- [ ] **Step 5: ビルド・目視**(`screenshot.sh plan`)。確認: 既定 Dynamic Type でヒーロー・警告・日タブ・最初の停留所(Task 7 後)が初見に入る。 → **Step 6: Commit** — `git commit -m "The result screen answers its five questions in order"`

---

### Task 7: タイムライン(ホテルレグ・MovementCard・ActivityCard・食事行)

**Files:**
- Create: `apple/TripCheck/Screens/Plan/{TimelineList,ActivityCard,MovementCard,MealRow,HotelLegRow}.swift`
- Modify: `Sources/TripCheckAppCore/Store/PlannerStore+ViewModel.swift`(`timelineRows(day) -> [TimelineRow]`)
- Test: `Tests/TripCheckAppCoreTests/TimelineRowsTests.swift`

**Interfaces:**
- Produces: `enum TimelineRow: Identifiable { case hotelLeg(HotelLegModel), movement(MovementModel), activity(ActivityModel), meal(MealModel) }`、`ActivityModel { stopId, number: Int, time: String, name, areaAndStay: String(「エリア · 滞在の目安 1時間30分」), accessNote: String?, flags: [ActivityFlag], isFiller: Bool, colorHex }`、`MovementModel { legKey, summary: String(「電車 95分・乗換1回」/「電車 約1時間」), from, to, icon: String, options: [(mode, label, selected, enabled)], evidenceLine: String? }`、`MealModel { slotId, kind, time, label }`、`HotelLegModel { direction, label }`

- [ ] **Step 1: テスト**

```swift
@Test func timelineRowsAlternateMovementAndActivity() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let rows = store.timelineRows(0)
  let kinds = rows.map { r -> String in if case .activity = r { return "A" }; if case .movement = r { return "M" }; if case .meal = r { return "F" }; return "H" }
  #expect(kinds.first == "A" || kinds.first == "H")
  #expect(!kinds.joined().contains("MM"))
  #expect(rows.contains { if case .meal = $0 { return true }; return false })
}

@Test func estimatedStayUsesTheWordMeyasu() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  guard case .activity(let a) = store.timelineRows(0).first(where: { if case .activity = $0 { return true }; return false })! else { return }
  #expect(a.areaAndStay.contains("目安"))
}

@Test func walkOptionOnlyUpToNinetyMinutes() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  for row in store.timelineRows(0) { if case .movement(let m) = row, let walk = m.options.first(where: { $0.mode == .walk }) { #expect(walk.enabled == (walkMinutes(m) <= 90)) } }
}
```

- [ ] **Step 2: 失敗を確認** → **Step 3: 実装** — `timelineRows` は `plan.days[i]` を `startBase → legs/stops → meal slots(TimelinePresentation.mealSlotsAfterStop)→ endBase` の順に畳む。`ActivityCard`: `Button`(行全体、≥44pt)= 時刻(`meta`)・デイカラーの番号ドット(Filler は `fork`/`spark` アイコン)・名前(`stopName`)・`areaAndStay`(`meta`)・アクセス注記・フラグチップ(`warnBg` 地、その日休み/最終入場後/予約に遅れる)。タップで `store.openInspector(.stop(id))`。`MovementCard`: `DisclosureGroup` 風(手段アイコン・summary・`A → B`・シェブロン)、展開で手段ピッカー(`SegmentedPills`、徒歩は ≤90 分のみ有効、選択で `store.setLegMode(legKey:, mode:)`(Task 9 のガード経由))と証拠行。`MealRow`: 破線枠・紫系は使わず `accentSoft`? → spec は「破線・紫の推薦枠」= `Color(hex: 0x7C3AED)` の破線。食事行は時刻と「昼食の目安」ラベルのみ(候補は次 spec)。`HotelLegRow`: 「ホテルから 徒歩 約5分」1 行(34pt)。

- [ ] **Step 4: ビルド・目視** → **Step 5: Commit** — `git commit -m "The day reads top to bottom: leave the hotel, move, visit, eat, come back"`

---

### Task 8: 地図(MapKit)

**Files:**
- Create: `apple/TripCheck/Map/{TripMapView,PinView,MapLegend}.swift`
- Modify: `Sources/TripCheckAppCore/Store/PlannerStore+ViewModel.swift`(`mapModel -> MapModel`)
- Test: `Tests/TripCheckAppCoreTests/MapModelTests.swift`

**Interfaces:**
- Produces: `MapModel { pins: [MapPin { id, coordinate: GeoPoint, kind: anchor(number)|filler|meal(kind)|hotel|manual|warning, dayIndex, colorHex, label, a11y }], routes: [MapRoute { dayIndex, points: [GeoPoint], measured: Bool, selected: Bool }], region: (center, span) , legendDays: [(index, colorHex)] }`、`PlannerStore.mapModel(scope: all|day) -> MapModel`、`PlannerStore.focusStop(id:)`

- [ ] **Step 1: テスト**

```swift
@Test func unmeasuredLegsAreDashedStraightLines() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let m = store.mapModel(scope: .all)
  #expect(m.routes.allSatisfy { !$0.measured })          // 鍵ゼロ: 実測ジオメトリは無い
  #expect(m.routes.allSatisfy { $0.points.count == 2 })
  #expect(m.pins.filter { if case .anchor = $0.kind { return true }; return false }.count == 8)
  #expect(m.pins.allSatisfy { !$0.a11y.isEmpty })
}

@Test func degenerateBoundsGetAMinimumSpan() {
  let m = MapModel.region(for: [GeoPoint(latitude: 35.0, longitude: 139.0), GeoPoint(latitude: 35.001, longitude: 139.001)])
  #expect(m.span.latitudeDelta >= 0.006)
}
```

- [ ] **Step 2: 失敗を確認** → **Step 3: 実装**

```swift
// Map/TripMapView.swift(抜粋)
struct TripMapView: View {
  @Environment(PlannerStore.self) private var store
  @State private var camera: MapCameraPosition = .automatic
  var body: some View {
    let model = store.mapModel(scope: store.view.mapScope)
    Map(position: $camera) {
      ForEach(model.routes) { r in
        MapPolyline(coordinates: r.points.map(\.clLocation))
          .stroke(Color(hexString: DayPalette.color(forDayIndex: r.dayIndex)).opacity(r.selected ? 0.95 : 0.28),
                  style: StrokeStyle(lineWidth: r.selected ? 5 : 2, lineCap: .round, dash: r.measured ? [] : [2, 12]))
      }
      ForEach(model.pins) { pin in
        Annotation(pin.label, coordinate: pin.coordinate.clLocation, anchor: .bottom) {
          PinView(pin: pin, highlighted: store.view.mapFocusedStopId == pin.id).onTapGesture { store.focusStop(id: pin.id); store.openInspector(for: pin) }
        }.annotationTitles(.hidden)
      }
    }
    .mapStyle(.standard(pointsOfInterest: .excludingAll, showsTraffic: false))
    .mapControls { MapScaleView(); MapCompass() }
    .overlay(alignment: .bottomLeading) { MapLegend(days: model.legendDays, scope: $store.view.mapScope).padding(12) }
    .onChange(of: store.view.selectedDay) { _, _ in camera = .region(model.region.mkRegion) }
    .onAppear { camera = .region(model.region.mkRegion) }
    .accessibilityElement(children: .contain)
  }
}
```

`PinView`: 円(デイカラー塗り + 白縁)+ 番号(`label` 11pt/800 白)、Filler は輪郭 + `spark`、食事 `fork`、ホテル `bed`、手動 `plus`、警告は右上に `!` バッジ。`MapLegend`: 日ボタン(色ドット + 番号)、「実線=実測 / 破線=推定」、「番号=予定地点 / ✦=おすすめ」、スコープ `全体|この日`、折り畳み可。

- [ ] **Step 4: ビルド・目視**(地図タブ、破線が出る、ピンタップで詳細) → **Step 5: Commit** — `git commit -m "The map shows each day in its colour and never draws a route it has not measured"`

---

### Task 9: 詳細シート(StopInspector)・日の設定シート・ガード付き編集・Undo/Redo・トースト

**Files:**
- Create: `apple/TripCheck/Screens/Detail/{StopInspector,EvidenceDisclosure}.swift`, `apple/TripCheck/Screens/Plan/DaySettingsSheet.swift`, `apple/TripCheck/Components/Toast.swift`, `Sources/TripCheckAppCore/Store/PlannerStore+Edits.swift`, `Sources/TripCheckAppCore/Model/Toast.swift`
- Test: `Tests/TripCheckAppCoreTests/GuardedEditFlowTests.swift`

**Interfaces:**
- Produces: `PlannerStore.applyGuardedEdit(_ mutate: (inout PlannerEditState) -> Void, label: String) async`(候補 state → `BuildRunner.run` → `PlannerEdits.evaluate` → `.apply` なら `history.commit` + `bundle` 更新 + `toast(label, bufferDelta, undo)` / `.confirm` なら `view.pendingHardEdit = PendingHardEdit(conflicts, apply: …)`)、`confirmPendingEdit() async`、`cancelPendingEdit()`、`undo() async`、`redo() async`(履歴の present から再ビルド)、`canUndo/canRedo`、11 アクション: `removeStop(id:)`, `restoreStop(id:)`, `moveStop(id:, toDay:)`, `changeTripDays(_:)`, `setLegMode(legKey:, mode:)`, `setStayMinutes(stopId:, minutes: Int?)`, `setLastEntry(stopId:, time: String?)`, `setDayStart(day:, time:)`, `setDayEnd(day:, time: String?)`, `applyAlternative(_ alt: TripCounterfactual)`, `setBase(_: ResolvedStop?)`;
  `PlannerStore.inspector(for stopId) -> StopInspectorModel { number, name, meta, dayOptions: [Int], stayOptions: [Int?](自動/30/45/60/90/120/150/180/240), currentStay, lastEntry, stayBasisLine, evidenceLines: [(label, value, status)], mapsUrl: URL, appleMapsUrl: URL, canRemove }`

- [ ] **Step 1: テスト**

```swift
@Test func harmlessEditAppliesAndIsOneUndo() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let id = store.bundle!.plan.days[0].stops[0].stop.id
  await store.setStayMinutes(stopId: id, minutes: 120)
  #expect(store.edit.userStayMinutes[id] == 120); #expect(store.view.toast != nil); #expect(store.canUndo)
  await store.undo()
  #expect(store.edit.userStayMinutes[id] == nil); #expect(store.canRedo)
}

@Test func removingAMustStopAsksFirst() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland)
  store.request.entries[0].priority = .must
  await store.build()
  let id = store.bundle!.plan.days.flatMap(\.stops).first { $0.priority == .must }!.stop.id
  await store.removeStop(id: id)
  #expect(store.view.pendingHardEdit?.conflicts.first?.kind == .must_drop)
  #expect(!store.edit.removedStops.contains { $0.id == id })
  await store.confirmPendingEdit()
  #expect(store.edit.removedStops.contains { $0.id == id })
}

@Test func changingDaysReRunsTheSameEngineNotACopy() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  await store.changeTripDays(5)
  #expect(store.bundle?.plan.days.count == 5); #expect(store.bundle?.request.days == 5)
}
```

- [ ] **Step 2: 失敗を確認** → **Step 3: 実装(AppCore)** — `applyGuardedEdit`: `var candidate = edit; mutate(&candidate)`; `let before = bundle!.plan`; `let req = tripRequest(with: candidate)`; `let after = await Task.detached { BuildRunner.run(req) }.value`; 世代ガード; `switch PlannerEdits.evaluate(before: before, after: after.plan, context: req.context)`。トーストは `Toast(text: "\(label) 余裕 \(delta)分", undo: true, kind: .edit)` 6 秒(`Task.sleep` で自動消去、`reduceMotion` 非依存)。`undo()`: `history = history.undo(); edit = history.present; rebuild(silent)`。

- [ ] **Step 4: 実装(UI)** — `StopInspector` を `.sheet(item: $store.view.inspector)` + `.presentationDetents([.fraction(0.3), .medium, .large], selection: detent)`、`.presentationDragIndicator(.visible)`。中身: ヘッダー(番号ドット・名前・`meta`、閉じる `close`)/「日を移動」`SegmentedPills`(複数日のみ)/ `EvidenceDisclosure`(`DisclosureGroup`「営業時間・根拠を見る」: `stayBasisLine`、事実ごとに `label: value(status 語)`)/ `DisclosureGroup`「この場所の条件を変える」(滞在 `Picker`、最終入場 `DatePicker` + クリア)/ `Link`「Apple Maps で開く」「Google Maps で開く」/ **最後に** 赤文字ボタン「予定から外す」。`DaySettingsSheet`: 一日の開始 `Picker`(08:00/09:00/10:30 + 任意時刻)、終了(なし/19:30/21:30 + 任意)。`pendingHardEdit` は `.alert(isPresented:)`(見出しは `VerdictCopy.hardEditTitle(conflicts)`「予約に N 分遅れます」、ボタン「外さない」「外す」)。`Toast`: 画面下のピル(`role="status"` 相当 = `accessibilityAddTraits(.updatesFrequently)` + `AccessibilityNotification.Announcement`)。シェイク Undo: `UIWindow.motionEnded` を `NotificationCenter` 経由で `store.undo()`、`⌘Z`/`⇧⌘Z` は `.keyboardShortcut`。

- [ ] **Step 5: ビルド・目視**(外す → 確認 → トースト → 元に戻す) → **Step 6: Commit** — `git commit -m "Every change goes through the guard, and one shake brings the plan back"`

---

### Task 10: IssueCard・結論の詳細(日数ステッパー・代替案 ≤3・仮定・カバレッジ)・出発前チェック

**Files:**
- Create: `apple/TripCheck/Screens/Plan/{IssueCard,VerdictDetails,BeforeYouGoCard}.swift`, `Sources/TripCheckAppCore/Store/PlannerStore+BeforeYouGo.swift`
- Test: `Tests/TripCheckAppCoreTests/{VerdictDetailsModelTests,BeforeYouGoTests}.swift`

**Interfaces:**
- Produces: `PlannerStore.verdictDetails -> VerdictDetailsModel { daysStepper: (value, min: 1, max: 14), factCounts: (verified, estimated, unknown), coverage: (label, hasUnknown), comparison: (original, minimalRepair, shortest)?(existing_itinerary のみ), alternatives: [AlternativeModel { id, title, diff: [(label, before, after)], lossLine: String?, apply: TripCounterfactual }], assumptions: [String], attentions: [String] }`、`PlannerStore.beforeYouGo -> BeforeYouGoModel { passportCountry: unset|jp|other, passportExpiry: String?, items: [PreTripItem { urgency: overdue|due_soon|scheduled|info, label, detail, url: URL? }], medicineLines: [String], essentials: [(label, value)] }`、`PlannerStore.setPassportCountry(_:)`, `setPassportExpiry(_:)`(`UserDefaults` `tripcheck.passportExpiry`)

- [ ] **Step 1: テスト**

```swift
@Test func alternativesShowRealDiffAndApplyGoesThroughGuard() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); store.request.tripDays = 2; await store.build()
  let alts = store.verdictDetails.alternatives
  #expect(alts.count <= 3)
  if let first = alts.first { await store.applyAlternative(first.apply); #expect(store.canUndo || store.view.pendingHardEdit != nil) }
}

@Test func passportRuleOnlyJudgesJapanesePassports() {
  let store = PlannerStore(resolvers: [], store: nil); store.loadSample(.switzerland)
  store.request.tripStartDate = "2026-10-13"
  store.setPassportCountry(.other); #expect(store.beforeYouGo.items.allSatisfy { $0.urgency == .info })
  store.setPassportCountry(.jp); store.setPassportExpiry("2027-01-01")
  // タイは 6 か月必要 → 更新が必要と出る。スイス(Schengen)は 3 か月 beyond stay
  #expect(store.beforeYouGo.items.contains { $0.label.contains("旅券") || $0.label.lowercased().contains("passport") })
}

@Test func etiasIsNotRequiredYetAndKEtaExpiresEndOf2026() {
  var store = PlannerStore(resolvers: [], store: nil); store.request.destination = .destination(.france); store.request.tripStartDate = "2026-10-13"
  #expect(store.beforeYouGo.items.first { $0.label.contains("ETIAS") }?.urgency == .info)
  store = PlannerStore(resolvers: [], store: nil); store.request.destination = .destination(.korea); store.request.tripStartDate = "2027-02-01"
  #expect(store.beforeYouGo.items.first { $0.label.contains("K-ETA") }?.detail.contains("免除") == false)
}
```

- [ ] **Step 2: 失敗を確認** → **Step 3: 実装** — `VerdictDetailsModel` は `bundle.result/fit/counterfactuals` から。代替案の `diff` は `before/after` の `hardConflictCount / overrunMinutes / minimumSlackMinutes / travelMinutes` を `TripPresentation.formatDuration` で。`BeforeYouGo` は `lib/pre-trip-timeline.ts` の規則(`PreTripItem { dueDate, opensDate, urgency }`、`due_soon` = 7 日、旅行日未定なら全て `info`)を AppCore に移植(Kit ではなく AppCore に置く理由: `UserDefaults` と「今日」に依存するため。純粋部分 `PreTripTimeline.items(destination:, tripStartDate:, today:, passport:)` は Kit の `Destinations` 隣に置いてもよい)。UI: `IssueCard`(「確認したいこと N」+ 種類ごと 1 行 + 行動ボタン)、`VerdictDetails`(`DisclosureGroup`「結論の詳細」: `Stepper` 1–14(`accessibilityValue` に日数)、3 数、カバレッジ、代替案カード(diff テーブル + 「この変更を適用」)、仮定・注意の箇条書き)、`BeforeYouGoCard`(旅券国 `SegmentedPills` unset/JP/other、JP のときだけ `DatePicker`、`is-overdue/is-due-soon` を `danger/warn` 色、公式リンク `Link`、薬の固定行)。

- [ ] **Step 4: ビルド・目視** → **Step 5: Commit** — `git commit -m "Below the plan: what to check, what else would work, and what to do before leaving"`

---

### Task 11: 保存・最近の旅程・自動保存・再開

**Files:**
- Create: `Sources/TripCheckAppCore/Store/PlannerStore+Persistence.swift`, `apple/TripCheck/Screens/Start/RecentTripsSection.swift`
- Test: `Tests/TripCheckAppCoreTests/PersistenceFlowTests.swift`

**Interfaces:**
- Produces: `PlannerStore.recentTrips: [StoredTripRecord]`、`PlannerStore.storageUnavailable: Bool`、`PlannerStore.openTrip(id:) async`(以前のプロバイダ状態を捨て、`pinned` の `.apple` は `providerRef` 無しなので座標ごと保存してある→`estimated` のまま再利用。`.catalog` は再解決)、`PlannerStore.deleteTrip(id:) async`、自動保存(550ms デバウンス、`request.entries`/`edit` の変化で)、`UserTripPayload` の `input` = `TripRequestState` の Codable(`resolutions` と `mixedCountryCodes` は除く)、`edits` = `PlannerEditState`

- [ ] **Step 1: テスト**

```swift
@Test func autosaveWritesInputAndEditsOnly() async throws {
  let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  let store = PlannerStore(resolvers: [CatalogResolver()], store: TripStore(directory: dir), autosaveDebounce: .milliseconds(10))
  store.loadSample(.switzerland); await store.build()
  try await Task.sleep(for: .milliseconds(50))
  let rec = await store.recentTrips.first
  #expect(rec != nil)
  #expect(rec!.payload.input["entries"] != nil); #expect(rec!.payload.edits["tripDays"] != nil)
  #expect(rec!.payload.input["plan"] == nil)
}

@Test func reopeningRebuildsFromInputAndKeepsEdits() async throws {
  let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  let s1 = PlannerStore(resolvers: [CatalogResolver()], store: TripStore(directory: dir), autosaveDebounce: .milliseconds(10))
  s1.loadSample(.switzerland); await s1.build(); await s1.changeTripDays(5); try await Task.sleep(for: .milliseconds(50))
  let s2 = PlannerStore(resolvers: [CatalogResolver()], store: TripStore(directory: dir))
  await s2.loadRecent(); await s2.openTrip(id: s2.recentTrips[0].id)
  #expect(s2.bundle?.plan.days.count == 5)
}

@Test func storageFailureFallsBackToMemoryWithAWarning() async {
  let store = PlannerStore(resolvers: [], store: TripStore(directory: URL(fileURLWithPath: "/dev/null/impossible")))
  store.loadSample(.switzerland); await store.build()
  #expect(store.storageUnavailable)
}
```

- [ ] **Step 2: 失敗を確認** → **Step 3: 実装** — `RecentTripsSection`: 「プランに戻る」(bundle があるとき)、非永続警告、最近の旅程(タイトル = 先頭 3 か所の名前、開く/削除 スワイプ)。

- [ ] **Step 4: ビルド・目視**(アプリを kill → 再起動 → 最近の旅程から開く) → **Step 5: Commit** — `git commit -m "Trips stay on the phone and come back exactly as edited"`

---

### Task 12: 共有(Web 互換リンク + tripcheck://)と URL での取込

**Files:**
- Create: `Sources/TripCheckAppCore/Store/PlannerStore+Share.swift`, `apple/TripCheck/Screens/Share/ShareSheet.swift`
- Modify: `apple/TripCheck/App/TripCheckApp.swift`(`.onOpenURL`)
- Test: `Tests/TripCheckAppCoreTests/ShareFlowTests.swift`

**Interfaces:**
- Produces: `PlannerStore.shareableInput() -> ShareableTripInput`、`PlannerStore.sharePreview(scope:) -> ScopedShareResult`、`PlannerStore.shareURLs(scope:) -> (web: URL, app: URL)?`(`https://tripcheck-japan-tokyo.syoki.chatgpt.site/\(locale == .ja ? "ja" : "")#t=\(code)` と `tripcheck://t/\(code)`)、`PlannerStore.importShare(code:) async -> Bool`、`static func shareCode(from url: URL) -> String?`(両形式)

- [ ] **Step 1: テスト**

```swift
@Test func shareRoundTripsThroughTheAppScheme() async {
  let s1 = PlannerStore(resolvers: [CatalogResolver()], store: nil); s1.loadSample(.switzerland); await s1.build(); await s1.changeTripDays(5)
  let urls = s1.shareURLs(scope: .init(dates: true, hotel: false, airports: false, reservations: false))!
  #expect(urls.web.absoluteString.hasPrefix("https://tripcheck-japan-tokyo.syoki.chatgpt.site/ja#t="))
  let code = PlannerStore.shareCode(from: urls.app)!
  #expect(code == PlannerStore.shareCode(from: urls.web))
  let s2 = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  #expect(await s2.importShare(code: code))
  #expect(s2.edit.tripDays == 5); #expect(s2.request.entries.count == 8)
}

@Test func reservationsAreRedactedUnlessIncluded() async {
  let s = PlannerStore(resolvers: [CatalogResolver()], store: nil); s.loadSample(.switzerland)
  s.request.entries[0].isReservation = true; s.request.entries[0].fixedTime = "10:00"; await s.build()
  #expect(s.sharePreview(scope: .init(dates: true, hotel: false, airports: false, reservations: false)).redactedReservationCount == 1)
  #expect(s.sharePreview(scope: .init(dates: true, hotel: false, airports: false, reservations: true)).warnings.contains(.RESERVATION_DETAILS_INCLUDED))
}
```

- [ ] **Step 2: 失敗を確認** → **Step 3: 実装** — `ShareSheet`: 4 つの `Toggle`(既定 dates のみ ON)、墨消し件数・省略行・警告の文、`blocked` なら CTA 無効、`ShareLink(item: web, subject:)` 「この内容でリンクをコピー」と「アプリ用リンク」の 2 つ。`.onOpenURL { if let code = PlannerStore.shareCode(from: $0) { Task { await store.importShare(code: code) } } }`。

- [ ] **Step 4: ビルド・目視**(`xcrun simctl openurl booted "tripcheck://t/<code>"` で取込) → **Step 5: Commit** — `git commit -m "A link from the phone opens on the web, and a web link opens on the phone"`

---

### Task 13: 印刷シート(PDF)

**Files:**
- Create: `apple/TripCheck/Screens/Print/{TripPrintSheet,PDFExporter}.swift`
- Modify: `Sources/TripCheckAppCore/Store/PlannerStore+ViewModel.swift`(`printModel -> PrintModel`)

**Interfaces:**
- Produces: `PrintModel { title, verdict, assumptions: [String], coverage: String, conflicts: [String], airportNotes: [String], days: [(label, date, rows: [(time, name, address, stay, arrival, departure)])], holidays: [String] }`、`PDFExporter.render(_ view: some View, pageWidth: CGFloat = 612) -> URL`(`ImageRenderer` + `UIGraphicsPDFRenderer`、A4/Letter 幅、複数ページは `proposedSize` の高さで分割)

- [ ] **Step 1: テスト(AppCore)** — `printModel` が全日程・全停留所を含み、`BannedTerms` を通ること。

```swift
@Test func printModelListsEveryStopWithFullTimes() async {
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
- Create: `apple/TripCheckUITests/PlannerFlowTests.swift`, `Tests/TripCheckAppCoreTests/{CopyBoundaryTests,IconCoverageTests}.swift`
- Modify: `apple/tools/verify-app.sh`(`test` で UI テストも)、`apple/README.md`

- [ ] **Step 1: 言語切替** — `PlanToolbar` の `日本語 | EN`(`SegmentedPills`)→ `store.changeLocale(_:)`: `request.locale` を変え、`bundle` は**捨てない**(hero/行は `locale` から再導出されるので表示だけ変わる)、実行中ビルドは `buildGeneration += 1` で中断。初期値は `Locale.current.language.languageCode == "ja" ? .ja : .en`、`UserDefaults["tripcheck-locale"]` があればそれ。

- [ ] **Step 2: 文言・アイコンの走査テスト(AppCore)**

```swift
@Test func noViewFileContainsJapaneseOrEnglishSentenceLiterals() throws {
  let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("TripCheck")
  let jp = try JSRegex("\"[^\"]*[぀-ヿ㐀-鿿][^\"]*\"")
  for f in try FileManager.default.subpathsOfDirectory(atPath: root.path) where f.hasSuffix(".swift") && !f.contains("Design/") {
    let text = try String(contentsOf: root.appendingPathComponent(f), encoding: .utf8)
    #expect(jp.matches(in: text).isEmpty, "\(f) has a Japanese literal — move it to PlannerCopy")
    for m in try JSRegex("Text\\(\"([^\"]{12,})\"\\)").matches(in: text) { Issue.record("\(f): inline Text literal \(m.groups[0] ?? "")") }
  }
}

@Test func everyIconHasAPath() {
  for icon in Icon.allCases { #expect(!IconShape(icon: icon).path(in: CGRect(x: 0, y: 0, width: 24, height: 24)).isEmpty, icon.rawValue) }
}
```

(`IconShape` は App ターゲットにあるため、このテストは `TripCheckUITests` ではなく App の Unit テストターゲット `TripCheckTests` を `project.yml` に追加して置く。`type: bundle.unit-test`, `sources: [TripCheckTests]`, `dependencies: [{target: TripCheck}]`。)

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

各ビューに `.accessibilityIdentifier("…")` を付ける(上の ID 一覧)。`-uiTesting` ではアニメーションを切り、`TripStore` を一時ディレクトリに。

- [ ] **Step 4: アクセシビリティ仕上げ** — 日タブ `accessibilityAddTraits(.isTabBar)`/`.isSelected`、`DayTimeBar` の `accessibilityLabel`、ビルド完了・Undo・hard 違反の `AccessibilityNotification.Announcement`、全 `Button` に ≥44pt の `contentShape`、`@Environment(\.accessibilityReduceMotion)` で `withAnimation` を素通し。Dynamic Type `accessibility5` で `screenshot.sh a11y5`(`xcrun simctl ui booted content_size accessibility-extra-extra-extra-large`)を撮り、横スクロールと重なりが無いことを目視。

- [ ] **Step 5: verify-app.sh を test 対応に** — `xcodebuild … test -only-testing:TripCheckUITests -only-testing:TripCheckTests`。README に手順と最終検証値(UI テスト 3/3、AppCore テスト N、スクショ一覧)を記録。

- [ ] **Step 6: Commit** — `git commit -m "The phone app speaks both languages, reads aloud, and proves its first screen"`

---

## 自己レビュー記録

- **Spec 網羅**: §4.3 Apple 解決器 → Task 5、§5.1 状態 → Task 2、§5.2 入力 → Task 3/4、§5.3 画面 8 つ → Task 3(Start)/5(Resolve)/6(Build, Plan 骨格)/7(タイムライン)/9(Detail)/12(Share)/13(Print)/6(Error は `RootView` の `.error` 分岐、Task 6 で追加)、§5.4 地図 → Task 8、§5.5 保存・ロケール → Task 11/14、§5.6 デザイン → Task 1、§5.7 a11y → Task 14、§6 エラー処理 → Task 5(unresolved)/6(issues)/11(storageUnavailable)/12(blocked)、§7 テスト → 各タスク + Task 14、§10 ファーストビュー契約 → Task 14 の `testFirstViewportContractAtDefaultType`。
- **Plan 1 との型整合**: `PlannerEditState`(Kit)をそのまま `store.edit` に使う。`PlaceResolution`/`PlaceCandidate`/`ResolutionPipeline` は Plan 1 Task 21、`ShareCodec`/`ShareScope` は Task 23、`TripStore` は Task 25、`GapDetection` は Task 22、`VerdictCopy`/`TimelinePresentation`/`TripPresentation`/`DayPalette`/`BannedTerms` は Task 24 の名前。
- **未決の小さな判断(実装者が決めてよい)**: Anton の TTF が取れないときのフォールバック(Task 1)、`pre-trip-timeline` の純粋部分を Kit と AppCore のどちらに置くか(Task 10)。
- **Plan 2 の前提が崩れるケース**: Plan 1 で API 名が変わったら、本計画の Interfaces を先に更新してから着手する。
