# TripCheck UI/UX 基準

このディレクトリが、TripCheck の**画面・体験の基準**です。以後の画面設計・
コンポーネント設計は、ここを参照して決めます。

| ファイル | 役割 |
| --- | --- |
| [`design-standard-v3.1.md`](design-standard-v3.1.md) | **規範。** 参照資料を TripCheck の実際のトークン・コンポーネント名に翻訳したもの。実装とレビューはこれを引用する |
| [`implementation-2026-08-13.md`](implementation-2026-08-13.md) | 2026-08-13 の実装記録。写真・評価★の判断、変えなかったものとその理由、検証値 |
| [`gap-2026-08-13.md`](gap-2026-08-13.md) | 着手前（2026-08-13 朝）の差分の実測。何がどれだけ違ったかの記録 |
| [`source/`](source/) | 受領物そのまま。`TripCheck_UIUX_Final_Handoff_Spec_v3.1.md` と参照画像4枚 |

## 参照画像

| ファイル | 中身 |
| --- | --- |
| `source/reference/01-start-desktop.jpg` | 入力画面（デスクトップ）。見出し・チップ入力・日数・旅程プレビュー |
| `source/reference/02-plan-desktop.jpg` | 結果画面（デスクトップ）。ヒーロー文・日ピル・タイムライン・地図 |
| `source/reference/03-plan-desktop-recommendation.jpg` | 結果画面＋推薦パネル（3カラム）。動線コスト・採用トースト |
| `source/reference/04-mobile-three-screens.jpg` | モバイル3画面。入力／旅程／地図＋詳細シート |

出典は `TripCheck_UIUX_Final_Handoff_v3.1.zip`（2026-08-13 受領）。画像は原本の
まま、ファイル名だけ内容が分かるものに変えています。

## 優先順位

矛盾したときの強さの順です。

1. **`docs/product.md` の v0.3 contract** — 何を真実として言ってよいか。
   実現性判定・Anchor/Filler・推薦の上限・ファーストビュー契約（Gate E）。
   v3.1 はここを弱めません。
2. **`design-standard-v3.1.md`** — 見た目・情報量・語彙・コンポーネント責務。
3. **Live UX Handoff v1.1** — v3.1 が触れていない範囲（コピーデッキ、
   アクセシビリティ、QA マトリクス）では引き続き有効。見た目の方向が
   衝突する箇所は v3.1 が優先し、その差分は `design-standard-v3.1.md` §4 と
   `gap-2026-08-13.md` に明記してあります。
4. **Code Level Refactor Spec v2.1** — コード構造・責務分離。UI の見た目には
   関与しません。

v3.1 は **UI/UX の方向のみ**を定義する、と受領物自身が書いています
（`source/README.txt`）。計算エンジン・実現性判定・セキュリティの仕様は
そのまま有効です。
