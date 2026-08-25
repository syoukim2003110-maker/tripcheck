# Worker 認証 実機チェックリスト

Simulator は App Attest 非対応なので、本物のアテステーションはここでしか確かめられない。
自動テストは全てフェイク/バイパスで通っている。これは「本物の鍵と Apple の証明書で
1 度だけ門が開く」ことを人の手で確かめる手順。

## 1. Mac 側で Worker を起動

`.dev.vars` に 2 行足す(値はそのまま):

    TRIPCHECK_APP_IDS=T8L5BPC2XJ.com.muraoshoki.tripcheck
    TRIPCHECK_APP_ATTEST_ENVIRONMENTS=development

そして dev サーバを起動:

    pnpm dev

Mac の名前を確認しておく(例 `MacBook.local`):`scutil --get LocalHostName` に `.local` を足す。

## 2. iPhone を繋いで診断ビルドを流す

iPhone を USB で繋ぎ、Xcode の scheme の Run 引数に足す:

- Arguments Passed On Launch: `-workerDiagnostics`
- Environment Variables: `TRIPCHECK_WORKER_BASE_URL` = `http://<Mac名>.local:3000`

実機を選んで Run。

## 3. 診断画面で確かめる

- 「State」が `authenticated` になる(初回は attest → D1 に本物の keyId が載る)
- 「疎通を確認」を押して「認証付き応答を受信しました。」が出れば完了
- 2 回目以降の起動は assert 経路(counter が単調増加)で同じく通る

うまくいかないとき:App ID が `.dev.vars` の `TRIPCHECK_APP_IDS` と一致しているか、
Mac と iPhone が同じ Wi-Fi にいるか、`http://` を許すため Info.plist に
`NSAllowsLocalNetworking` が入っているか(project.yml 由来)を見る。
