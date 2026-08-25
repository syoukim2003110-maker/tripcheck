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
