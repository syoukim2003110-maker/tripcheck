# Apple Developer 有料会員の引き出し — TripCheck への適用案

**提案(未承認)** — 作成日: 2026-08-23

- これは spec ではない。承認済みの `docs/superpowers/specs/2026-08-21-tripcheck-swift-v1-design.md`(以下「v1 design」)と、現在進行中の Plan 2(鍵ゼロ iOS アプリ 14 タスク)には**何も変更を加えない**。
- 目的: ユーザーが有料 Apple Developer Program 会員であることから引き出せる MapKit 系無料 API・端末内 LLM を 7 案(うち 1 案は 2 変種)棚卸しし、後で読んで「次にどれを spec化するか」を決めるための資料にする。
- 元資料: `/Users/muraoshoki/.claude/jobs/ca26b62e/tmp/plan2-validate/drawer.json`(Kit のソースを実際に grep して検証したアーキテクトの評価)。file:line の引用は全てこの資料に基づく。

---

## 1. 前提と決定

**Plan 2 には何も取り込まない。** v1 design §1.3 は Plan 2 の範囲外として「Worker のアプリ認証 / Google 候補検索・場所解決・実経路・営業時間・transit 収束 / 天気・祝日 / 食事・寄り道・ホテル推薦の取得 / AI ラベル・fresh voices / 計測 / TestFlight 配布 / iPad 最適化 / iCloud 同期」を明記している(v1 design 45行目)。ここで棚卸しした 7 案は例外なく、このいずれかに触れるか、次のいずれかを必要とする — 新しい Kit プロトコル、新しい entitlement、iOS 26 フロア、または §5.3/§5.4 の spec 変更。drawer.json の結論を引くと「nothing here is free enough to fold into the approved Plan 2 scope」。したがって本書は**次 spec 群への提案**であって、進行中の 14 タスクへの割り込みではない。

**Plan 1 の穴。** Kit に実在するプロトコルは `PlaceResolver` の 1 つだけ(`apple/Packages/TripCheckKit/Sources/TripCheckKit/Resolution/PlaceResolver.swift:81`)。v1 design §1.3 は「ただし型とプロトコル(`PlaceResolver` / `RouteProvider` / `RecommendationSource`)は本 spec で切る」と明記している(v1 design 45行目)のに、`RouteProvider` と `RecommendationSource` は Kit のどこにも存在しない(grep 0 件)。これは Plan 1 が果たしていない約束であり、Plan 2 の pre-flight でも解消していない。

**裁定。** 2 つのプロトコルの形は、Apple 側の実装(MKDirections アダプタ、MKLocalPointsOfInterestRequest アダプタ)を書いて初めて具体的に決まる。今すぐ空の型として宣言するのは工数 S で spec 上も正当だが、中身のない宣言を先に置くより、**下記 §4 の推奨順で「案1: 実経路」の spec が `RouteProvider` を、「案7: 食事候補」を含む推薦 spec が `RecommendationSource` を、それぞれ定義と同時に切る**方が、後から型を作り直す手戻りがない。Plan 2 側では「2 つのプロトコルが未実装である」ことだけを記録すれば足りる。

---

## 2. 一覧表

| # | 案 | 鍵ゼロ | 最低 OS | 必要な設定 | 答える spec 項目 | 工数 | 推奨 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | MKDirections(徒歩/車の実経路 + transit ETA) | ✓ | iOS 17 | なし(スロットリング対策は実装側の責務) | §1.3 実経路、§5.4 実線ポリライン、§5.3 MovementCard 推定/実測 | M | **次 spec の第 1 候補** |
| 2 | Apple Maps Server API(Worker 経由) | ✗(サーバ経由) | 制約なし | Maps ID + MapKit JS 秘密鍵(.p8)、Worker が ES256 JWT 発行。App Attest(案6)が前提 | §0 行1、§1.3 実経路/transit 収束、§4.2 resolver chain | L | 後で |
| 3a | Look Around プレビュー | ✓ | iOS 16(SwiftUI Preview は 17) | なし | §5.3 Detail(写真行の追加) | S | 後で |
| 3b | iOS 18 Place Card + 営業時間 | ✓ | iOS 18(要 `#available` ゲート) | なし。**営業時間はデータとして取得不可** | §1.3 営業時間、§5.3 Detail | M | 後で |
| 4 | Foundation Models(端末内 LLM) | ✓ | iOS 26 + Apple Intelligence 対応端末 | なし(端末側で AI 有効化が前提) | §5.2 未解析行、§1.3 AI ラベル | M | 後で |
| 5 | WeatherKit | ✓ | iOS 16 | WeatherKit capability + entitlement(有料会員必須)、帰属 UI 必須 | §1.3 天気/祝日、§5.3 Plan 行(3) | M | 後で |
| 6 | App Attest → Worker 認証 | ✗ | iOS 14(Simulator 非対応) | App Attest capability + entitlement(有料会員必須)、Worker 側 D1 実装 | §0 行1、§1.3 Worker のアプリ認証、§5.5 プライバシー | L | **次 spec の第 1 候補** |
| 7 | MKLocalPointsOfInterestRequest(食事候補) | ✓ | iOS 14 | なし | §9 行8、§1.3 食事/寄り道/ホテル推薦、§5.3 Plan 行(4) | M | 後で |

「見送り」に分類した案はない — drawer.json の 7 評価は全て「今は後で」までで、恒久的に不採用としたものはない。

---

## 3. 各案の詳細

Evidence の共通ルール(v1 design §4.2): **Apple 由来を `verified` にしない**。実測分は `PlannerContext.liveWalkingMinutes` / `liveDrivingMinutes` / `liveTransitMinutes` 経由でのみエンジンに入る(`Builder/PlannerContext.swift:59-69``TripBuilder.swift:240-253``Legs.swift:83-106``TravelEstimates.swift:212-248`)。この経路さえ守れば G1(golden 500)・G3(TS スナップショット照合)フィクスチャは live* キーを一切持たないため、パリティは自動的に保たれる。

### 3.1 案1 — MKDirections(実経路)

- **旅行者に何をもたらすか**: 徒歩・車の実測に近い移動時間とポリライン、日本・スイスなど対応地域では transit の ETA(オンデバイス、キー不要)。
- **フックポイント**: Kit に `RouteProvider` を新設(現状皆無)。App に `TripCheckAppCore/Providers/AppleRouteProvider.swift` を新設。分は `PlannerContext.live*` 経由のみ、ジオメトリは `MKRoute.polyline → PlannerViewState.routeGeometryByLegKey`(新設、Web も view state として `TripPlannerShell.tsx:155` に保持)→ `Map/TripMapView.swift` の `MapPolyline`。
- **Evidence 規則**: 徒歩/車の事実は構造的に `verified` にならない(`EvidenceSnapshot.swift:191-198` の `exactLiveValue` は mode==transit 必須)ので、安全に `estimated/derived`(source `.live`)に落ちる。
- **落とし穴**: (a) transit ETA を `liveTransitMinutes` に流すと `routeEvidenceByFactId` が無いまま `provisionallyMeasured → estimated` になるが、source 表示は `.google` に固定される(`EvidenceSnapshot.swift:180`)— v1 では徒歩/車のみ供給するか、Swift 限定の `EvidenceSnapshotOptions.liveRouteSource` + 新しい `EvidenceSource` ケースが要る。(b) Copy はプロバイダ固有(`legLive: "Google Maps経路"` `CopyJa.swift:130`、`BannedTerms.swift:12` は「実測」→「Google Maps経路データ」に変換)なので `legLiveApple` キーの新設が必要 — さもないと Apple 由来のデータが Google 由来と表示される。(c) 未文書化のスロットリング(`MKError.loadingThrottled`)— 12 か所×4 日で最大 40 脚×3 モードの相当量になるので leg-key キャッシュと同時実行 ≤4 が必須。(d) transit ETA カバレッジは地域依存(日本・スイスはあるが多くの地域は無い)。

### 3.2 案2 — Apple Maps Server API(Worker 経由)

- **旅行者に何をもたらすか**: directions/etas/search をサーバ側から。250,000 call/day 無料枠。
- **フックポイント**: `worker/index.ts` の Google Routes ハンドラの隣に新プロバイダ分岐(新設)。`paidRequestIsSameOrigin`(`worker/index.ts:96-108`)がネイティブクライアントを拒否するため、案6(App Attest)が前提条件。
- **Evidence 規則**: 案1と同じだが政策上の論点が一つ増える — Apple サーバ経由の transit directions は `departureDate` を伴うため、技術的には `RouteFactEvidence(status: .verified, requestKey:, departureBucket:, providerRef:)` を組んで `exactLiveValue` を通せてしまう。アダプタが意図的にこれをやらない実装ルール、またはこのケースだけ spec を明示的に改定する判断が要る。
- **落とし穴**: TS 側 `PlanningRoutePrefetch.provider` は文字列リテラル `"google_maps"` 固定(`lib/planning-live-routes-client.ts:53`)、`TransitProviderObservation`(`lib/transit-convergence.ts:38-55`)への Apple 対応追加は `lib/` を触ることになり、v1 design の「Web に触らない」方針に反する。Google Routes と機能が重複し、費用面以外の優位がない。

### 3.3 案3a — Look Around プレビュー

- **旅行者に何をもたらすか**: 停留所詳細にストリートレベルのプレビュー画像。
- **フックポイント**: App のみ。`Screens/Detail/StopInspector.swift` に `LookAroundPreview(initialScene:)` 行を新設、`MKLookAroundSceneRequest(coordinate:)` を `@MainActor` アダプタで呼ぶ。Kit の型は不要 — `ResolvedStop.latitude/longitude`(`Builder/BuiltPlan.swift:176-177`)のみ使う。
- **Evidence 規則**: 影響なし。Evidence/CriticalFact/Copy を一切生まない。Kit は MapKit を import しない(`ImportBoundaryTests.swift:23` が強制)。
- **落とし穴**: カバレッジは地域限定(日本は広い、スイス/欧州は都市部中心)、`scene == nil` のことがある。座標を Apple に送るので統合仕様 §13.2 の開示表に行を追加する必要がある。シートを開くたびのネットワーク呼び出しは stop id でキャッシュすべき。Reduce Motion 対応も要る。

### 3.4 案3b — iOS 18 Place Card + 営業時間

- **旅行者に何をもたらすか**: Apple 純正の場所カード表示。**営業時間はカード内表示としては見えるが、データとして取得する手段が iOS 26 まで含めて確認されていない**(`MKMapItem` は name/placemark/phoneNumber/url/pointOfInterestCategory/timeZone のみ)。
- **フックポイント**: App の `StopInspector.swift` に `#available(iOS 18, *)` ゲート付きで新設。`TripCheckAppCore/Providers/ApplePlaceResolver.swift` で `mapItem.identifier?.rawValue` を App 側フィールド(`WishlistEntry.pinnedResolution` / `PlannerViewState`)に保持し、**`ResolvedStop.providerRef` には入れない**。
- **Evidence 規則(危険)**: `EvidenceSnapshot.swift:86` は truthy な `providerRef` を source `google` に変換し、`:102` で providerRef として表出、`:89` は `sourceUrl` + `verifiedAt` から `verified` を導く。id 接頭辞 `google-`/`hotel-` も読まれる。Apple の place id はこの経路の外に置き、`verifiedAt` は空文字のままにしないと Apple 由来が `verified` として出てしまう。
- **落とし穴**: カードは営業時間を「見せる」のに、判定文は「営業時間不明」と言う矛盾が起きうる — Detail のコピーで「これは Apple のカード表示であって TripCheck の根拠ではない」旨を明示する必要(`openingEvidenceByStop` は Apple から決して埋めないので hours は `.unknown` のまま、`:284-286`)。§1.3 が本当に欲しい「営業時間データ」そのものには、この案は答えられない。

### 3.5 案4 — Foundation Models(端末内 LLM)

- **旅行者に何をもたらすか**: 貼り付け取込で解析できなかった行を、確認可能なエントリ候補に変換するアシスタント。将来的には Worker の Anthropic 呼び出しに代わる AI ラベル/fresh voices の端末内ソース。
- **フックポイント**: App の `TripCheckAppCore`、`WishlistParser.parse` 後、`ParsedWishlistLine.unparsed(raw:)`(`Parser/WishlistParser.swift:47`)のみを対象にする。ユーザーが確認した結果は `WishlistSerializer`(`Parser/WishlistSerializer.swift`)で正本テキストへ戻す。
- **決定論規則**: パーサ合成コーパス(G2、`Tests/.../Golden/ParserCorpusTests.swift:48,131`)のパリティは、モデルが `WishlistParser` の前段や代替として走らない限り保たれる。エンジンは同期・決定論・I/O なし(§3.1)なので、非決定性はビルド経路に絶対入れない。ヒーロー文・判定文・警告文の生成にこれを使わないこと — §1.2 項目3 の Tier A/B/C 語彙固定と BannedTerms スキャンが壊れる。
- **落とし穴**: iOS 26 限定、Apple Intelligence 対応端末(iPhone 15 Pro/A17 Pro 以降)限定 — 日本語は対応言語だが端末要件が壁になる。`Package.swift` の macOS 14 フロアでは `swift test` で検証できない(実機/シミュレータでのランタイム分岐が必要)。コンテキストは約 4k トークン。

### 3.6 案5 — WeatherKit

- **旅行者に何をもたらすか**: 日別の降雨リスクなど天気表示(Web の Open-Meteo 相当)。
- **フックポイント**: App のみ。`TripCheckAppCore/Providers/AppleWeatherProvider.swift` を新設し、Web の表示専用の形 `TripWeatherDay{index,date,kind,temperatureMaxC,temperatureMinC,precipitationPercent}`(`lib/weather.ts:24-38`)をそのまま踏襲、provider literal を `apple_weather` に、`PlannerViewState` に格納して `Screens/Plan/DayTabs.swift` 等で表示。Kit は一切触らない — Kit に天気シンボルは存在せず(grep 0 件)、Web も天気をエンジン外に置く(`weatherByDay[activeDay]`、`TripPlannerShell.tsx:2207`)。
- **Evidence 規則**: 天気は表示専用のまま(Web と同じ)。`FeasibilityResult`/`PlannerContext` に警告コードや屋外ペナルティを追加しないこと — それは Swift 限定の分岐になり G3 が検知できず「Web に触らない」方針に反する。天気を CriticalFact にしない(`verified` ステータスを一切持たせない)。
- **落とし穴**: WeatherKit capability + entitlement(`project.yml` に `com.apple.developer.weatherkit`)の追加が必要(有料会員が前提)。`WeatherService.attribution` のロゴ+リーガルリンク表示が必須。予報ホライズンが日次 10 日/時間 240 — 出発が 10 日超先、または未定(日付なし)の旅程では何も出せない。

### 3.7 案6 — App Attest → Worker 認証

- **旅行者に何をもたらすか**: 直接見えるものはない(基盤整備)。これが通ると Worker 経由の Google resolver(場所の verified 化)、営業時間、transit 収束、食事/寄り道/ホテル推薦、AI ラベルが解禁される。
- **フックポイント**: Worker の `paidRequestIsSameOrigin`(`worker/index.ts:96-108`)とヘッダーベースの旅程識別(`X-TripCheck-Trip`、`:172`)に `X-TripCheck-Attest`/アサーション分岐を新設。App 側は `TripCheckAppCore/Providers/WorkerClient.swift`(新設)+ Keychain の keyId 保存。Worker はアテステーションオブジェクト(CBOR + X.509 チェーン、nonce = チャレンジの SHA256)を初回のみ検証し、keyId + counter を D1 に保存(既存の `X-TripCheck-Quota-Scope: durable-d1` ヘッダーから D1 は既に配線済みと確認できる)。以降はリクエストごとの P-256 アサーションを Web Crypto `ECDSA` で検証し、カウンタの単調増加を確認する。
- **Evidence 規則**: エンジン/Evidence には影響なし。TS パリティも非該当(Worker は `lib/` の外)。
- **落とし穴**: Simulator は `DCAppAttestService.shared.isSupported` が `false` — 実機テストが必須で、開発/本番用の non-production bypass が要る。App Attest capability + entitlement(有料会員が前提)。より簡易な DeviceCheck という代替もあるが「実機であること」しか証明できず、リクエスト単位の完全性やクォータ紐付けはできないので、Worker 側の要件には App Attest が適切。

### 3.8 案7 — MKLocalPointsOfInterestRequest(食事候補)

- **旅行者に何をもたらすか**: 食事枠(将来的には寄り道/ホテル)の候補地表示。**評価・レビュー数・価格帯・写真・営業時間は一切取得できない**(`MKMapItem` の範囲は名前・座標・カテゴリ・電話・URL のみ)。
- **フックポイント**: Kit に `RecommendationSource` を新設(現状皆無、案1の `RouteProvider` と同じ §1.3 の穴)。入力は既存の `MealSlots.build(days:destination:mealPlan:locale:) -> [FoodRecommendationSlot]`(`Builder/MealSlots.swift:84-89`、`BuiltTripPlan.foodRecommendationSlots` `Builder/BuiltPlan.swift:508`)がそのまま使える — アンカー座標・エリア・食事種別・時間窓・検索語のフィールドは Web の `FoodSearchRequest` と同型。App: `TripCheckAppCore/Providers/AppleFoodSource.swift` + `Screens/Plan/MealRow.swift` の候補チップ(いずれも新設)。
- **Evidence 規則**: 候補は表示専用で、採用時のみ既存のガード付き編集(§5.1)を通って新しい停留所になる。採用した Apple 候補は `providerRef = nil`、`verifiedAt = ""`、id 接頭辞に `google-`/`hotel-` を使わない `ResolvedStop` として構築する(`EvidenceSnapshot.swift:86-103`)— `estimated` のまま、営業時間は `unknown` のまま。
- **落とし穴**: §9 行8 は明示的に「候補取得は次 spec」としてスロット表示止まりにしている。評価/レビューがないので価値が薄い(「400m 以内に 12 件あります」程度しか言えず、既存の Maps リンクで代替可能)。Web 版の `foodNote` コピー(「Googleの評価・口コミ量…」`CopyJa.swift:146`)をそのまま流用できない。

---

## 4. 推奨する順番

drawer.json の評価では案1(MKDirections)と案6(App Attest)がともに「次 spec の第 1 候補」タグを持つ(§0 が App Attest を "次 spec で追加" と明言する一方、案1は鍵ゼロで entitlement 不要という条件面で先行できる)。本書では案1を先に置く順を提案する。

1. **MKDirections 実経路 + `RouteProvider`/`RecommendationSource` の型定義**(鍵ゼロ、§1.3「実経路」に答える)。ユーザーが見るもの: 徒歩/車の移動時間が実測に近づき、選択日の地図に実線ポリラインが引かれる。
2. **App Attest → Worker 認証**(Google resolver/営業時間/推薦の解禁に必要)。ユーザーが見るもの: 直接の変化はない(基盤整備)。以降の Worker 系機能すべての前提。
3. **WeatherKit + 祝日**。ユーザーが見るもの: 日タブに天気アイコン・降水確率、祝日/日曜閉店の注記が付く。
4. **Look Around / Place Card**(表示専用)。ユーザーが見るもの: 詳細シートにストリートプレビュー画像、iOS 18 端末なら Apple 純正の場所カード。
5. **Foundation Models 未解析行アシスタント**(iOS 26 サブセット)。ユーザーが見るもの: 貼り付け取込で読み取れなかった行に「AI が提案した候補」が出て、確認して追加できる。
6. **Apple Maps Server API**(Google Routes のコストが実測で問題になった場合のみ)。ユーザーが見るもの: 表面上の変化なし(裏側の経路取得元が切り替わりうる)。
7. **MKLocalPointsOfInterestRequest**(推薦 spec の中で、`RecommendationSource` の実装の一つとして)。ユーザーが見るもの: 食事枠に周辺候補のチップが並ぶ(評価は付かない)。

---

## 5. ユーザーへの質問

1. Foundation Models(案4)は iOS 26 + Apple Intelligence 対応端末のみに提供し、それ以外の端末では従来通り「確認が必要な行」のリストだけを見せる、という前提で spec化して良いか。
2. WeatherKit(案5)の帰属 UI は、日ヘッダー内の小さいバッジと Detail の折り畳みの中のどちらを想定しているか。
3. §4 の順序案(①実経路 → ②App Attest)で良いか、それとも先に App Attest を済ませて Google resolver の `verified` 化を先に得る順にするか — drawer.json はどちらも「次 spec の第 1 候補」としており、この順序はユーザー判断が必要。
4. App Attest(案6)は Simulator でテストできないため実機検証が要る。開発/本番の non-production bypass をどの範囲まで許すか、実機テストの運用(誰が・どの頻度で)は決めておくか。
5. Apple Maps Server API(案2)へ切り替える基準(Google Routes の月間呼び出し数や費用の閾値)を今のうちに数値で決めておくか、それとも問題が実測されてから都度判断するか。
