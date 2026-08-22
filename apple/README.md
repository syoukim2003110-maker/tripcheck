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

アプリ側は XcodeGen(`~/.local/xcodegen/bin/xcodegen`、2.46)が要る。

```
apple/tools/verify-app.sh          # generate → iPhone 17 Pro シミュレータ向けに build
apple/tools/verify-app.sh test     # UI テストまで
apple/tools/screenshot.sh boot     # 起動中のシミュレータを PNG に
```

DerivedData は `apple/build`(`apple/.gitignore`)。組んだものを端末に入れて開くのは

```
xcrun simctl install booted apple/build/Build/Products/Debug-iphonesimulator/TripCheck.app
xcrun simctl launch booted com.muraoshoki.tripcheck
```

## 見出しの書体

`TripCheck/Design/Fonts/Anton-Regular.ttf` は Google Fonts の OFL 版(`ofl/anton`)をそのまま同梱している。SIL Open Font License 1.1 は配布時にライセンス本文を添えることを求めるので、`OFL.txt` も同じ場所に置いて bundle に入れてある。PostScript 名は `Anton-Regular`(`Typography.displayFaceName`)で、`Info.plist` の `UIAppFonts` から登録される。同梱が外れた版では `Typography` が system の太字に落ちる。

| ファイル | sha256 |
| --- | --- |
| `Anton-Regular.ttf` | `a4ba3a92350ebb031da0cb47630ac49eb265082ca1bc0450442f4a83ab947cab` |
| `OFL.txt` | `ee67e6ee22790b7929f1a3769ca2801d565c64b5a9096942c1adf5596de9c9e4` |

## 検証値(2026-08-23、`apple/tools/verify-kit.sh` を 3 回)

**563 本すべて passed / `exit=0`**。内訳は Golden 11・不変条件 227・単体 324・smoke 1。

3 回のうち 2 回は素の状態、1 回は 15 コアを全部埋めた状態(load average 26 → 29)で回した —— どれも 563 本 passed / `exit=0`。以前 `--parallel` で照合が落ちたのは load average 7 台のときだったので、その 4 倍の負荷でも動かないことを見ている。

| | 母集団 | 結果 |
| --- | --- | --- |
| G1 golden | `golden-feasibility.v1.json` の 500 件(`Golden/GoldenParityTests.swift`) | oracle の全節で **500/500**。修復対 200 組が硬い実行不能を跨いで反転。全 500 件の二度組みと、原型 10 種 × 100 回の再現が完全一致 |
| G2 パーサ | 合成コーパス 500 件(`Golden/ParserCorpusTests.swift`) | 候補分割 **F1 = 1.0**(閾値 0.97)。recall / precision / 明示マーカー / 見出し / 日割り当ても全て 1.0。1 件あたりの p95 は 200ms 未満 |
| G3 TS 照合 | golden 500 + builder 23(`Golden/SnapshotParityTests.swift`) | `plan` / `fit` / `evidence` / `result` をフィールド単位で突き合わせて **差分 0**。除外は 61 行・4 種類だけで、その全行が実際に差分を飲み込んでいることを `everyIgnoredPathStillEarnsItsPlace` が検査する(付録 A) |
| 共有リンク | `Fixtures/share-vectors.json`(`Units/ShareCodecTests.swift`) | ベクタ **17/17** が Web と**バイト同一**、スコープ付き墨消し **68/68** も同じ。復号だけのベクタ 29 件も Web と同じ値に着く |
| JSMath | `Fixtures/js-math-vectors.v1.json`(`Units/JSMathTests.swift`) | V8 `12.4.254.21-node.27`(フィクスチャの `v8Version` そのまま。Node 22.18.0)と **86,510 標本がビット一致**(緯度の cos/sin 45,002、小引数 sin 20,001、asin 20,001、π/2 近傍 240、中規模還元 322、巨大引数 242、builder コーパスの全順序対 702 辺) |
| Kit 境界 | `Invariants/ImportBoundaryTests.swift` | Kit のソースに `import Foundation` 以外が無い。`PlannerViewState` の名前も現れない(spec §5.1) |

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
