# apple/ — TripCheck の Swift 実装

- `Packages/TripCheckKit`: 決定論エンジン(`import` は Foundation だけ)。回すのは `apple/tools/verify-kit.sh`。
- `Packages/TripCheckKit` の `TripCheckAppCore`: 画面の手前側(状態・文言・MapKit の場所解決)。Kit と違って端末の framework を import してよい。中身は Plan 2 の Task 2 以降。
- `TripCheck/`: iPhone アプリ本体。`project.yml`(XcodeGen)から `TripCheck.xcodeproj` を起こす —— プロジェクトは生成物なので commit しない。回すのは `apple/tools/verify-app.sh`。
- 移植元は `../lib/`。golden 500(`Tests/TripCheckKitTests/Fixtures/golden-feasibility.v1.json`)は `../tests/fixtures/` の**バイト同一のコピー**で、更新するときは Web 側で再生成してからコピーし直す(こちらで編集しない)。
- 設計は `../docs/superpowers/specs/2026-08-21-tripcheck-swift-v1-design.md`、計画は `../docs/superpowers/plans/`。UI と Apple 側の場所解決(MapKit)は Plan 2 の担当で、この Kit には入らない。

## 回す

```
apple/tools/verify-kit.sh                 # 既定は --parallel。末尾に exit=<code> を出す
apple/tools/verify-kit.sh --serial        # 1 本ずつ(失敗の出力を落ち着いて読みたいとき)
apple/tools/verify-kit.sh --filter Golden # そのほかの引数は swift test へそのまま渡る
```

並列を既定にしているのは、この suite が**並列で緑であること自体が検査対象**だから。実時計に触るテストが混ざると機械の忙しさで答えが変わる —— 照合系(G1/G3)は `Tests/TripCheckKitTests/Support/FrozenClock.swift` の止まった時計を使い、予算切れの側は `TestStops.timedOutTriple()` の刻む時計が受け持つ。

`Locale.current` を読むのは `TripCheckApp.init`(合成の根)だけ —— `PlannerStore.init` は `initialLocale` 引数(既定 `.ja`)を受け取るだけで、走らせる機械の言語を読まない。`swift test` はどの機械の言語設定でも同じ緑になる。

アプリ側は XcodeGen(`~/.local/xcodegen/bin/xcodegen`、2.46)が要る。

```
apple/tools/verify-app.sh          # generate → iPhone 17 Pro シミュレータ向けに build
apple/tools/verify-app.sh test     # 単体テスト(TripCheckTests)と UI テスト(TripCheckUITests)の両方
apple/tools/screenshot.sh boot     # 起動中のシミュレータを PNG に
```

的は 2 つある。`TripCheckTests`(単体)は**アプリのソースそのものを読む走査**で、`IconShape` / `SVGPath` / `Icon` が App ターゲットの型なので AppCore 側には置けない。`TripCheckUITests` はシミュレータの上で 5 本の道を通す。`test` は `-only-testing:` で両方を名指しするので、片方が的から外れたまま緑になることがない。

UI テストは `-uiTesting` を渡してアプリを起こす。この旗が立つと `TripCheckApp` は 3 つを切り替える —— 旅程の保存先を使い捨ての一時ディレクトリへ、`UserDefaults` を毎回消す専用の箱(`com.muraoshoki.tripcheck.uitest`)へ、そしてアニメーションを止める(UIKit 側は `UIView.setAnimationsEnabled(false)`、SwiftUI 側は根の `.transaction`)。動いている札は `XCUIElement` の位置が定まらないので掴めない。

DerivedData は `apple/build`(`apple/.gitignore`)。組んだものを端末に入れて開くのは

```
xcrun simctl install booted apple/build/Build/Products/Debug-iphonesimulator/TripCheck.app
xcrun simctl launch booted com.muraoshoki.tripcheck
xcrun simctl openurl booted "tripcheck://t/<code>"           # 共有リンクを開く
xcrun simctl ui booted content_size accessibility-extra-extra-extra-large   # Dynamic Type の上限
xcrun simctl ui booted content_size large                    # 戻す
```

## 見出しの書体

`TripCheck/Design/Fonts/Anton-Regular.ttf` は Google Fonts の OFL 版(`ofl/anton`)をそのまま同梱している。SIL Open Font License 1.1 は配布時にライセンス本文を添えることを求めるので、`OFL.txt` も同じ場所に置いて bundle に入れてある。PostScript 名は `Anton-Regular`(`Typography.displayFaceName`)で、`Info.plist` の `UIAppFonts` から登録される。同梱が外れた版では `Typography` が system の太字に落ちる。

| ファイル | sha256 |
| --- | --- |
| `Anton-Regular.ttf` | `a4ba3a92350ebb031da0cb47630ac49eb265082ca1bc0450442f4a83ab947cab` |
| `OFL.txt` | `ee67e6ee22790b7929f1a3769ca2801d565c64b5a9096942c1adf5596de9c9e4` |

## 検証値(engine、2026-08-25、`apple/tools/verify-kit.sh`)

**861 本すべて passed / `exit=0`**(警告ゼロ)。`verify-kit.sh` はパッケージ全体を回すので、内訳は
`TripCheckKitTests` 593 と `TripCheckAppCoreTests` 268。前者は Plan 1 の 563 本に Task 10 の
`PreTripTimelineTests` 13 本、Routes spec の `LiveRouteMergeTests` 3 本・`EvidenceSourceTests` 2 本、
自由文インテント spec の `IntentTests` 6 本・`IntentResolutionTests` 6 本を足したもので、下の表
(G1/G2/G3・共有・JSMath・境界)はその中身。後者(AppCoreTests)は `IntentFlowTests` 8 本・
`IntentParserTests` 2 本を含む。

Routes spec(実経路)は **Kit の既存テストに 1 行も触っていない**。足したのは上の 2 ファイルだけで、
フィクスチャも不変 —— G1 は 500/500 のまま、G3 の差分もゼロ
(`git status -- Tests/TripCheckKitTests/Fixtures` が空であることを毎回確かめている)。

自由文インテント spec(Foundation Models)も同じ構え —— **Kit に足したのは決定的な型と純粋関数だけ**
(`Intent/TripIntent.swift` の `TripIntent` / `IntentOutcome` / `IntentParser` プロトコル、
`IntentTrigger.looksLikeTripSentence` の「文らしいか」判定、`IntentResolution` の「N泊」→日数・
「10月3日から」→日付の決定的な変換)。LLM を呼ぶコードは Kit のどこにも無い。端末内 LLM
(`FoundationModelsIntentParser`、iOS 26+ の `FoundationModels` を import)と UI テスト用の
`CannedIntentParser` はどちらも AppCore 側にあり、同じ `IntentParser` を実装するだけの差し替え可能な
実装 —— 起動時に `IntentAvailability.makeDefaultParser` が一度だけどちらを注入するか決める
(実経路の `RouteProvider` と同じミラー型シーム、spec §3)。フィクスチャは触っておらず、G1/G3 の
差分もゼロのまま。

Plan 1 のときの負荷試験もそのまま効く:3 回のうち 1 回は 15 コアを全部埋めた状態(load average 26 → 29)で回して passed / `exit=0` だった。以前 `--parallel` で照合が落ちたのは load average 7 台のときだったので、その 4 倍の負荷でも動かないことを見ている。

| | 母集団 | 結果 |
| --- | --- | --- |
| G1 golden | `golden-feasibility.v1.json` の 500 件(`Golden/GoldenParityTests.swift`) | oracle の全節で **500/500**。修復対 200 組が硬い実行不能を跨いで反転。全 500 件の二度組みと、原型 10 種 × 100 回の再現が完全一致 |
| G2 パーサ | 合成コーパス 500 件(`Golden/ParserCorpusTests.swift`) | 候補分割 **F1 = 1.0**(閾値 0.97)。recall / precision / 明示マーカー / 見出し / 日割り当ても全て 1.0。1 件あたりの p95 は 200ms 未満 |
| G3 TS 照合 | golden 500 + builder 23(`Golden/SnapshotParityTests.swift`) | `plan` / `fit` / `evidence` / `result` をフィールド単位で突き合わせて **差分 0**。除外は 61 行・4 種類だけで、その全行が実際に差分を飲み込んでいることを `everyIgnoredPathStillEarnsItsPlace` が検査する(付録 A) |
| 共有リンク | `Fixtures/share-vectors.json`(`Units/ShareCodecTests.swift`) | ベクタ **17/17** が Web と**バイト同一**、スコープ付き墨消し **68/68** も同じ。復号だけのベクタ 29 件も Web と同じ値に着く |
| JSMath | `Fixtures/js-math-vectors.v1.json`(`Units/JSMathTests.swift`) | V8 `12.4.254.21-node.27`(フィクスチャの `v8Version` そのまま。Node 22.18.0)と **86,510 標本がビット一致**(緯度の cos/sin 45,002、小引数 sin 20,001、asin 20,001、π/2 近傍 240、中規模還元 322、巨大引数 242、builder コーパスの全順序対 702 辺) |
| Kit 境界 | `Invariants/ImportBoundaryTests.swift` | Kit のソースに `import Foundation` 以外が無い。`PlannerViewState` の名前も現れない(spec §5.1) |

## 検証値(アプリ、2026-08-25、`apple/tools/verify-app.sh test` を 2 回)

2 回とも `TEST SUCCEEDED` / `exit=0`(警告ゼロ)。

| 的 | 本数 | 中身 |
| --- | --- | --- |
| `TripCheckTests`(単体) | 9 | `CopyBoundaryTests` 3 + `IconCoverageTests` 6 |
| `TripCheckUITests` | 6 | `PlannerFlowTests` 5 + `LaunchUITests` 1 |

`CopyBoundaryTests` は `apple/TripCheck` と AppCore の `Sources`(81 ファイル)を歩き、文字列リテラルに日本語の文が無いこと・`Text("…")` に長い文が直接座っていないこと・リテラルが `BannedTerms` を踏まないことを見る。除くのは `Design/` と `AppCopy.swift` の 2 つだけで、`JSRegex("…")` の引数だけは日本語を許す —— `AppleAddress` が日本の住所を切る 2 本は文ではなく**文法**である。植えたリテラルで落ちることを確かめてある(`SpareLine.swift` に 3 種類を順に植えて、3 種類とも赤になった)。

`IconCoverageTests` は 24 種の線と塗り、枠からのはみ出し、拡縮、線の太さ、そして**円弧が弧として引かれていること**(`pin` / `signal` / `moon` / `cloud`)を見る。Task 1 が残していた「`SVGPath` に自動の検査が無い」穴はここで塞がった。

`PlannerFlowTests` の 5 本 —— 見本 → 旅程 → 詳細 → 外す → 元に戻す、旅程 ↔ 地図の往復、**ファーストビュー契約**(統合仕様 §10:既定の文字サイズの iPhone 17 Pro で、最初の停留所がスクロール無しに見え、押せる)、**実経路が届くところ**(見本 → 進捗の行が消える → 移動カードで車を選ぶ → 地図に「実経路 N区間」が出る)、そして**自由文インテントがフォームへ展開するところ**(`testFreeTextIntentFillsTheStartForm`:文らしい入力に「旅の条件として読み取る」行が出る → タップ → canned の聞き取り(行き先 金沢・3泊→4日・ウィッシュ 海鮮/21世紀美術館)がフォームへ展開し、確認トーストが出る)。実経路の本は `-uiTesting` の `CannedRouteProvider` を、インテントの本は同じく `-uiTesting` の `CannedIntentParser` を通るのでどちらも通信しない —— 徒歩 12 分/km、車 max(3, 3 分/km)、公共交通 max(5, 4 分/km) の決定的な答えで同じ 2 点には毎回同じ分が返り、インテントは入力に依らず常に同じ答え(`CannedIntentParser.swift`)を返す。

### 目で見たもの(シミュレータ、iPhone 17 Pro)

| 文字サイズ | 撮ったもの |
| --- | --- |
| 既定(`large`) | 10 枚 —— Start 1・旅程を上から下まで 5・言語を EN にした旅程 1・日本語へ戻した旅程 1・地図 1・停留所の詳細 1 |
| `accessibility-extra-extra-extra-large` | 同じ 10 枚 |

実経路の 4 枚は別に撮ってある(既定の文字サイズ、`apple/tools/screenshot.sh`。出力は `${SCRATCHPAD:-/tmp}/tripcheck-<名前>.png`)。ホスト側に画面を押す手段が無いので、画面を進めるのは UI テスト(見本の 3 枚は `testSampleFetchesRoutesAndTheMapShowsAMeasuredLeg` が通る道の途中)と共有リンク(`xcrun simctl openurl booted "tripcheck://t/<code>"`、東京の 1 枚)の役で、撮る側は 1 秒ごとに `screenshot.sh` を呼ぶ。

| 撮ったもの | 名前 | 何が写っているか |
| --- | --- | --- |
| スイス見本(日付未定・`-uiTesting`) | `tripcheck-routes-swiss-toast` | 静かな置換の直後。旅程は組み直っているのに `.building` の画面を挟まず、知らせは「実経路で更新しました」の 1 行だけ(元に戻すは付かない) |
| 同じ旅程で移動カードを開き、車を選んだところ | `tripcheck-routes-swiss-evidence` | 手段の錠剤(徒歩 1000 分は選べないまま・電車 125 分・タクシー 224 分)と、その下の根拠行「Apple Maps の経路」 |
| 同じ旅程の地図 | `tripcheck-routes-swiss-map` | 車のレグが**実線**。左下に「実経路 1区間」、凡例は実線=実経路 / 破線=推定 |
| 東京 3 日・日付あり(2026-09-03、共有リンクで開いた**素のアプリ**) | `tripcheck-routes-tokyo-dated` | 日付が入ったので公共交通も測りに行き、「実経路で更新しました」が出たあとの電車 22 分・タクシー 18 分。提供元は本物の `AppleRouteProvider` |

**「Wi-Fi なし: N区間は推定のまま」は撮れていない。** シミュレータはホストの回線をそのまま使い、`simctl` に回線を落とす口が無い(`simctl status_bar` が変えられるのは**アイコンだけ**で通信は生きている)。ホストの Wi-Fi を切るのはこの検証の範囲を超えるので、代わりに機械の側で押さえてある —— `RouteEnrichmentTests.failedLegsStayEstimatedAndAreCounted`(測れなかったレグは推定のまま・`estimatedRemaining` に数えられる)と `AppCopyTests` の `routesEstimatedRemaining` がその 1 行の文言を見ている。

accessibility5 で見つけて直したものは 4 つ。時刻の列(`ActivityCard` / `MealRow` の 44pt 決め打ち)が 1 文字ずつ縦に折れていた、番号の丸(`ActivityCard` 22pt / `StopInspector` 24pt / 地図のピン)が中の数を欠いていた、地図の凡例の「全日程 | この日」が 190pt の枠で縦に折れていた、名札の `TripCheck` が語の途中で割れていた。どれも `@ScaledMetric`(上限つき)か `minimumScaleFactor` で直してある —— 直した後の 10 枚に横スクロールと重なりは無い。

### Apple の場所解決が置く証拠(`ApplePlaceResolver`)

端末の地図が返した停留所は**提供元の証拠を持たない**。`providerRef = nil`、`sourceUrl` と `verifiedAt` は空、`confidence = .medium`、`provider = .apple`、id は `apple-<inputIndex>-<hash>`。鍵ゼロで場所を引ける代わりに、営業時間も口コミも付いてこないので、`Feasibility` の数え上げでは「未確認」の側に落ちる —— 画面の 3 数(確認済み / 推定 / 未確認)がそう出るのはこのため。`ApplePlaceResolverTests.appleStopsCarryNoProviderEvidence` が 6 欄を名指しで留めている。

### 自由文インテント(Foundation Models)

検索窓に文らしい入力(「金沢に3泊、海鮮と21世紀美術館」のような文)をすると、候補の上に
「旅の条件として読み取る」の行が出る。この行が出るのは **iOS 26 以降・Apple Intelligence が使える
端末だけ**(`IntentAvailability.makeDefaultParser` が起動時に一度だけ判定 ——
`SystemLanguageModel.default.availability` が `.available` でなければ parser を注入せず、行そのものが
出ない)。非対応の端末では今までどおりの検索窓のまま —— エラーは出ず、従来 UI に静かに落ちる。
行をタップすると端末内 LLM(Foundation Models、鍵もネットワークも要らない)が走り、行き先は検索欄の
プリフィルに、日数・日付は `IntentResolution` の決定的な変換を経てフォームへ、やりたいこと・
食べたいものはウィッシュの行として展開する(確認ファースト —— 旅程へ直接書く経路は無く、フォームに
置くだけ)。**intent に無い欄は決してクリアしない**(`PlannerStore+Intent.apply`)。

**本物の LLM はホストの Apple Intelligence 状態に依存するため自動テスト対象外。** 検証は次の三本で
成り立っている。

1. **開発機プローブ**(spec §8、2026-08-24、Xcode 26.6 / iOS SDK 26.5 のホストで
   `availability = .available` を実測)。「9月に」から日付を捏造する・セッションを使い回すと単語
   入力に前回の答えが混ざる、といった実際の挙動もここで見つけて、spec §4.2 の「暦の計算は Swift
   側」「パースごとに新品セッション」という掟に落とし込んである。
2. **canned パーサの UI テスト**(`testFreeTextIntentFillsTheStartForm`、上表)。`-uiTesting` は
   常に `CannedIntentParser` を注入する(spec §4.5)—— シミュレータのホスト状態に自動テストを
   依存させないための構え。
3. **このホストでの手動確認**(Task 7、2026-08-25、iPhone 17 Pro シミュレータ)。`-uiTesting` を
   外した素の起動でも「旅の条件として読み取る」行が出ることを確かめた
   (`tripcheck-intent-row-real-fm`)—— このホストはシミュレータ自体が Apple Intelligence に
   対応している。ただしタップした先の実際の生成結果(表記・待ち時間)はホストの状態に左右され
   毎回同じ絵にならないため、適用後の画は撮っていない —— 下の 2 枚はどちらも canned の値。

| 撮ったもの | 名前 | 何が写っているか |
| --- | --- | --- |
| 文らしい入力に行が出た状態(canned、`-uiTesting`) | `tripcheck-intent-row` | 「Weekend trip to Kanazawa, seafood and museum」の入力中に、通常の場所候補の上に「旅の条件として読み取る」の行が出ている |
| 適用直後(canned) | `tripcheck-intent-applied-toast` | 検索欄が「金沢」に置き換わり、確認トースト「読み取りました。内容を確認して構築へ進んでください。」が出ている(自動で消える一過性の表示だが、この回は捕まえられた) |
| 適用後のフォーム(canned) | `tripcheck-intent-applied-wishlist` | ウィッシュに「海鮮」「21世紀美術館」の2行、「何日くらい?」が「4日」に選び直っている(3泊→4日の変換) |
| 素の起動(実機 Foundation Models、`-uiTesting` 無し) | `tripcheck-intent-row-real-fm` | 同じ文で「旅の条件として読み取る」の行が実モデル判定でも出ている。タップ後は撮っていない(上参照) |

### まだ直していないもの

- **紙の境目が行の途中に落ちると、その行が上下に割れる**(Task 13)。`PDFExporter` が `proposedSize` の高さで切るため。情報は両ページに揃うが見た目が悪い。直すなら塊単位で詰めるか、切り位置を空白の帯まで繰り上げる。
- **`https://…#t=<code>` は Web でしか開かない。** アプリが受けるのは `tripcheck://t/<code>` だけで、Associated Domains(`applinks:`)は入れていない —— 有料アカウントのドメイン設定が要るので、配布の話と一緒に決める。
- **食事の枠に店の候補は出ない**(枠そのものは事実なので行は残る)。次の spec。

## TS 側のフィクスチャを作り直す

Node ≥ 22(`package.json` の `engines` は `>=22.15.0`。上の値は 22.18.0 で採った)。`lib/` の TypeScript を直に読むものは `--experimental-strip-types` が要る。`lib/` は一切書き換えない。

```
node --experimental-strip-types scripts/export-golden-snapshots.mjs \
  --out apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Fixtures/ts-snapshots.v1.json \
  tests/fixtures/golden-feasibility.v1.json

node --experimental-strip-types scripts/export-golden-snapshots.mjs \
  --out apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Fixtures/ts-builder-snapshots.v1.json \
  apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Fixtures/builder-scenarios.v1.json

node --experimental-strip-types scripts/export-share-vectors.mjs \
  --out apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Fixtures/share-vectors.json

node scripts/export-js-math-vectors.mjs \
  --out apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Fixtures/js-math-vectors.v1.json \
  apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Fixtures/builder-scenarios.v1.json
```

`builder-scenarios.v1.json` を触ったら `ts-builder-snapshots.v1.json` と `js-math-vectors.v1.json` の両方を作り直す(後者は builder コーパスの座標から辺を数え直すため)。**照合が赤くなったときにフィクスチャを作り直して緑にするのは禁止** —— 作り直すのは TS 側を意図して変えたときだけで、そうでなければ差分はこちらの移植の話。

## 一致しているのは arm64 の V8 との間だけ

`Core/JSMath.swift` は V8 の `src/base/ieee754.cc` の移植で、その値は**V8 を積んだ CPU で変わる**。arm64 では Clang が融合積和(`fmadd`)に畳むが、x86-64 の既定ベースラインには FMA3 が無いので同じソースが別々の乗算と加算に落ちる。ここで作った一致は arm64 側のもので、x64 の Node / Chrome は `cos` で 1.13 %、`sin` で 2.27 %、`asin` で 1.31 % の標本が違うビット列になる。

距離が 1 ulp 動くと、往復が厳密に同点の日で**訪問順の向きが倒れ**、その日の脚・時刻・Maps URL・evidence の並びまで連鎖して変わる。つまり Web 版自身が arm64 ホストと x64 ホストで違う旅程を出しうる。詳細と測定値は設計文書の付録 A.3。

Swift 側の実行環境は関係しない(`fma()` は IEEE 754 の演算で、専用命令が無ければソフトウェアで同じ値を出す)。
