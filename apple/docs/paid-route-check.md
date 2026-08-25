# paid ルート(place-resolution)実地チェック

Simulator でも bypass セッションで通せる。実 Google キーが要る。

## 1. Worker をローカル起動
`.dev.vars` に置く:

    GOOGLE_PLACES_API_KEY=<本物のキー>
    TRIPCHECK_APP_ATTEST_BYPASS_TOKEN=<任意の開発用トークン>
    TRIPCHECK_QUOTA_HASH_SECRET=<32 文字以上>

起動: `pnpm dev`(Worker が 127.0.0.1:3000)。

## 2. Simulator を bypass で走らせる
環境変数 `TRIPCHECK_WORKER_BYPASS_TOKEN` を .dev.vars と同じ値にして起動:

    TRIPCHECK_WORKER_BYPASS_TOKEN=<同じトークン> でアプリを実行

## 3. 確認
地名(例「Tokyo Tower」)を入力して解決させる。停留所が **Google 検証済み**
(内部 id が `google-` 始まり、`sourceUrl`/`verifiedAt` が非空、`provider = .google`)
になっていること。Worker を止める / トークンを外すと、同じ入力が Apple(未検証、
`apple-` id)にフォールバックすること。

## 4. 実機
実機は bypass 不要 — 実 App Attest でセッションが出る(`worker-auth-device-checklist.md`
の手順で attest 済みなら、そのまま place-resolution も通る)。

## 5. Google サジェスト
検索窓の Apple 行の下に出る第 2 区画(`WorkerSuggestions`)も同じ鍵・同じ bypass で通す。

1. 上の 1・2 と同じく `.dev.vars` に実 `GOOGLE_PLACES_API_KEY` を置き、`pnpm dev` を
   起動。Simulator は `TRIPCHECK_WORKER_BYPASS_TOKEN` を .dev.vars と同じ値にして走らせる。
2. Start 画面の検索窓に 3 文字以上打つ(1・2 文字では Apple 行しか出ない ——
   `WorkerSuggestions.minimumQueryLength` が 3)。少し待つ(デバウンス)と、Apple 候補の
   下に区切り線・見出し(「ウェブの検索候補」)・Google 候補の行・`Powered by Google` の
   帰属が出る。
3. Google 行を選ぶと、入力欄には選んだ名前がそのまま入り(候補ではなく通常入力として
   渡る)、CTA で組んだときにその停留所が `google-` 始まりの検証済み id(`sourceUrl`/
   `verifiedAt` が非空、`provider = .google`)になっていることを確認する。
4. `.dev.vars` から鍵を外す(または Worker を止める / bypass トークンを外す)と、同じ
   3 文字以上の入力でも第 2 区画は一切出ず、Apple 候補だけが残ることを確認する。
