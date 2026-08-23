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

`TripCheckAppCoreTests` は**端末の言語が日本語である機械**を前提にしている。`PlannerStore` は `UserDefaults["tripcheck-locale"]` に選択が無ければ `Locale.current` で立ち上がり(`Store/PlannerStore+Locale.swift`)、AppCore のテストは 152 か所がその既定の入口で store を作って日本語の文言を表明するため、英語の機械では 20 本超が落ちる。`theseTestsAssumeAJapaneseDevice` がその理由を名指しで落ちるので、赤の読み方に迷わない。

アプリ側は XcodeGen(`~/.local/xcodegen/bin/xcodegen`、2.46)が要る。

```
apple/tools/verify-app.sh          # generate → iPhone 17 Pro シミュレータ向けに build
apple/tools/verify-app.sh test     # 単体テスト(TripCheckTests)と UI テスト(TripCheckUITests)の両方
apple/tools/screenshot.sh boot     # 起動中のシミュレータを PNG に
```

的は 2 つある。`TripCheckTests`(単体)は**アプリのソースそのものを読む走査**で、`IconShape` / `SVGPath` / `Icon` が App ターゲットの型なので AppCore 側には置けない。`TripCheckUITests` はシミュレータの上で 3 本の道を通す。`test` は `-only-testing:` で両方を名指しするので、片方が的から外れたまま緑になることがない。

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

## 検証値(engine、2026-08-23、`apple/tools/verify-kit.sh`)

**788 本すべて passed / `exit=0`**。`verify-kit.sh` はパッケージ全体を回すので、内訳は
`TripCheckKitTests` 576 と `TripCheckAppCoreTests` 212。前者は Plan 1 の 563 本に Task 10 の
`PreTripTimelineTests` 13 本が足されたもので、下の表(G1/G2/G3・共有・JSMath・境界)は
その中身 —— Plan 2 は Kit の既存テストに一切触っていない。

Plan 1 のときの負荷試験もそのまま効く:3 回のうち 1 回は 15 コアを全部埋めた状態(load average 26 → 29)で回して passed / `exit=0` だった。以前 `--parallel` で照合が落ちたのは load average 7 台のときだったので、その 4 倍の負荷でも動かないことを見ている。

| | 母集団 | 結果 |
| --- | --- | --- |
| G1 golden | `golden-feasibility.v1.json` の 500 件(`Golden/GoldenParityTests.swift`) | oracle の全節で **500/500**。修復対 200 組が硬い実行不能を跨いで反転。全 500 件の二度組みと、原型 10 種 × 100 回の再現が完全一致 |
| G2 パーサ | 合成コーパス 500 件(`Golden/ParserCorpusTests.swift`) | 候補分割 **F1 = 1.0**(閾値 0.97)。recall / precision / 明示マーカー / 見出し / 日割り当ても全て 1.0。1 件あたりの p95 は 200ms 未満 |
| G3 TS 照合 | golden 500 + builder 23(`Golden/SnapshotParityTests.swift`) | `plan` / `fit` / `evidence` / `result` をフィールド単位で突き合わせて **差分 0**。除外は 61 行・4 種類だけで、その全行が実際に差分を飲み込んでいることを `everyIgnoredPathStillEarnsItsPlace` が検査する(付録 A) |
| 共有リンク | `Fixtures/share-vectors.json`(`Units/ShareCodecTests.swift`) | ベクタ **17/17** が Web と**バイト同一**、スコープ付き墨消し **68/68** も同じ。復号だけのベクタ 29 件も Web と同じ値に着く |
| JSMath | `Fixtures/js-math-vectors.v1.json`(`Units/JSMathTests.swift`) | V8 `12.4.254.21-node.27`(フィクスチャの `v8Version` そのまま。Node 22.18.0)と **86,510 標本がビット一致**(緯度の cos/sin 45,002、小引数 sin 20,001、asin 20,001、π/2 近傍 240、中規模還元 322、巨大引数 242、builder コーパスの全順序対 702 辺) |
| Kit 境界 | `Invariants/ImportBoundaryTests.swift` | Kit のソースに `import Foundation` 以外が無い。`PlannerViewState` の名前も現れない(spec §5.1) |

## 検証値(アプリ、2026-08-23、`apple/tools/verify-app.sh test` を 2 回)

2 回とも `TEST SUCCEEDED` / `exit=0`。

| 的 | 本数 | 中身 |
| --- | --- | --- |
| `TripCheckTests`(単体) | 9 | `CopyBoundaryTests` 3 + `IconCoverageTests` 6 |
| `TripCheckUITests` | 4 | `PlannerFlowTests` 3 + `LaunchUITests` 1 |

`CopyBoundaryTests` は `apple/TripCheck` と AppCore の `Sources`(74 ファイル)を歩き、文字列リテラルに日本語の文が無いこと・`Text("…")` に長い文が直接座っていないこと・リテラルが `BannedTerms` を踏まないことを見る。除くのは `Design/` と `AppCopy.swift` の 2 つだけで、`JSRegex("…")` の引数だけは日本語を許す —— `AppleAddress` が日本の住所を切る 2 本は文ではなく**文法**である。植えたリテラルで落ちることを確かめてある(`SpareLine.swift` に 3 種類を順に植えて、3 種類とも赤になった)。

`IconCoverageTests` は 24 種の線と塗り、枠からのはみ出し、拡縮、線の太さ、そして**円弧が弧として引かれていること**(`pin` / `signal` / `moon` / `cloud`)を見る。Task 1 が残していた「`SVGPath` に自動の検査が無い」穴はここで塞がった。

`PlannerFlowTests` の 3 本 —— 見本 → 旅程 → 詳細 → 外す → 元に戻す、旅程 ↔ 地図の往復、そして**ファーストビュー契約**(統合仕様 §10:既定の文字サイズの iPhone 17 Pro で、最初の停留所がスクロール無しに見え、押せる)。

### 目で見たもの(シミュレータ、iPhone 17 Pro)

| 文字サイズ | 撮ったもの |
| --- | --- |
| 既定(`large`) | 10 枚 —— Start 1・旅程を上から下まで 5・言語を EN にした旅程 1・日本語へ戻した旅程 1・地図 1・停留所の詳細 1 |
| `accessibility-extra-extra-extra-large` | 同じ 10 枚 |

accessibility5 で見つけて直したものは 4 つ。時刻の列(`ActivityCard` / `MealRow` の 44pt 決め打ち)が 1 文字ずつ縦に折れていた、番号の丸(`ActivityCard` 22pt / `StopInspector` 24pt / 地図のピン)が中の数を欠いていた、地図の凡例の「全日程 | この日」が 190pt の枠で縦に折れていた、名札の `TripCheck` が語の途中で割れていた。どれも `@ScaledMetric`(上限つき)か `minimumScaleFactor` で直してある —— 直した後の 10 枚に横スクロールと重なりは無い。

### Apple の場所解決が置く証拠(`ApplePlaceResolver`)

端末の地図が返した停留所は**提供元の証拠を持たない**。`providerRef = nil`、`sourceUrl` と `verifiedAt` は空、`confidence = .medium`、`provider = .apple`、id は `apple-<inputIndex>-<hash>`。鍵ゼロで場所を引ける代わりに、営業時間も口コミも付いてこないので、`Feasibility` の数え上げでは「未確認」の側に落ちる —— 画面の 3 数(確認済み / 推定 / 未確認)がそう出るのはこのため。`ApplePlaceResolverTests.appleStopsCarryNoProviderEvidence` が 6 欄を名指しで留めている。

### まだ直していないもの

- **紙の境目が行の途中に落ちると、その行が上下に割れる**(Task 13)。`PDFExporter` が `proposedSize` の高さで切るため。情報は両ページに揃うが見た目が悪い。直すなら塊単位で詰めるか、切り位置を空白の帯まで繰り上げる。
- **`https://…#t=<code>` は Web でしか開かない。** アプリが受けるのは `tripcheck://t/<code>` だけで、Associated Domains(`applinks:`)は入れていない —— 有料アカウントのドメイン設定が要るので、配布の話と一緒に決める。
- **AppCore のテストは日本語の機械を前提にしている**(上の「回す」節)。152 か所の store 生成に言語を渡すか、test target 全体に効く trait で `Locale` を固定すれば消える。
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
