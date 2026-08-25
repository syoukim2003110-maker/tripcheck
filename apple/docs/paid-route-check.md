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

## 6. Google 実経路(live-routes)

合成の根(`TripCheckApp.init`)は非 UI テストのとき常に `WorkerRouteProvider(client:fallback:)`
を使う —— Google と端末内 Apple(`AppleRouteProvider`)を並行に呼び、Google が
`.measured` を綺麗に返せばそちらを採用、返せなければ(未認証・タイムアウト・非成功・
1 分未満)Apple に委ねる。

1. 上の 1・2 と同じく `.dev.vars` に実 `GOOGLE_PLACES_API_KEY`(Routes API が有効な
   キー)を置き、`TRIPCHECK_APP_ATTEST_BYPASS_TOKEN` / `TRIPCHECK_QUOTA_HASH_SECRET`
   も揃えて `pnpm dev` を起動。Simulator は `TRIPCHECK_WORKER_BYPASS_TOKEN` を
   `.dev.vars` と同じ値にして走らせる(`-uiTesting` は付けない —— 付けると
   `CannedRouteProvider` に固定され Worker を一切踏まない)。
2. 徒歩・タクシー・**交通機関**を含む旅程を組む。地図で交通機関レグに **線が引かれる**
   ことを確認する(Apple の `MKDirections` は `.transit` だと ETA しか返さず線を
   引けないので、Apple だけにフォールバックした区間は線無しのまま —— 線があること
   自体が Google 経由で解決できた証拠になる)。
3. 表示される所要分数が Google の値になっていること(Apple 単独時の分数と食い違って
   いれば Google が勝っている)を確認する。
4. Worker を止める、または `.dev.vars` から `GOOGLE_PLACES_API_KEY` を外すと、同じ
   旅程を組み直したときに交通機関レグの線が消え(Apple の ETA のみに戻り)、分数も
   Apple 側の値に変わることを確認する —— `WorkerRouteProvider` が Apple
   (`AppleRouteProvider` = `MKDirections`)へ黙って戻っている。

## 7. 食事候補(food-recommendations)

合成の根(`TripCheckApp.init`)は非 UI テストのとき常に
`FoodRecommendationAvailability.makeDefaultProvider(uiTesting:client:)` が返す
`WorkerFoodRecommender` を `PlannerStore` に渡す(`-uiTesting` は nil のまま —— タイムラインの
食事枠は決定的に「候補が見つかりませんでした」になる、これが UI 回帰テストの前提)。

1. 上の 1・2 と同じく `.dev.vars` に実 `GOOGLE_PLACES_API_KEY`(Places API が有効な
   キー)を置き、`pnpm dev` を起動。Simulator は `TRIPCHECK_WORKER_BYPASS_TOKEN` を
   `.dev.vars` と同じ値にして走らせる(`-uiTesting` は付けない)。
2. 旅程を組み、タイムラインの破線の食事枠(「候補を見る」ヒント付き)をタップする。
   下からシートが開き、名前・種別・評価・距離・住所を持つ候補カードが並ぶこと
   (`plan.foodCandidate`)を確認する。カードをタップすると Google マップの該当店へ
   遷移すること。
3. Worker を止める、または `.dev.vars` から鍵を外すと、同じ食事枠をタップしても
   カードは 1 件も出ず、「候補が見つかりませんでした」だけが出ることを確認する
   (`beginFoodFetch` が `foodRecommendationProvider == nil` を `.unavailable` として
   即座に返す道と同じ結果になる)。

## 8. 場所の詳細(place-intelligence)

合成の根(`TripCheckApp.init`)は非 UI テストのとき常に
`PlaceIntelligenceAvailability.makeDefaultProvider(uiTesting:client:)` が返す
`WorkerPlaceIntelligenceProvider` を `PlannerStore` に渡す(`-uiTesting` は nil のまま ——
「この場所について」カードは決定的に「詳細を取得できませんでした」になる、これが UI 回帰
テストの前提)。カードの入口自体は `RouteStop.providerRef` の有無(Google 検証済みかどうか)
で決まり、これは Worker の疎通とは別の条件 —— 鍵が無くても Apple フォールバックで解決した
停留所にはカードそのものが出ない。

1. 上の 1・2 と同じく `.dev.vars` に実 `GOOGLE_PLACES_API_KEY`(Places API が有効な
   キー)を置き、`pnpm dev` を起動。Simulator は `TRIPCHECK_WORKER_BYPASS_TOKEN` を
   `.dev.vars` と同じ値にして走らせる(`-uiTesting` は付けない)。
2. 地名を検索窓へ打ち込み、Google 検証済み(`google-` 始まりの id)の停留所として解決させて
   から旅程を組む。その停留所の詳細シートを開くと、根拠の開示部の下に「この場所について」
   カード(`plan.placeIntelligence`)が出る。
3. カードを開くと、初回だけ取得が走り(2 回目以降は同じ結果をそのまま出す)、営業時間・
   評価・要約が並ぶこと(`plan.placeIntelligence.loaded`)を確認する。
4. Worker を止める、または `.dev.vars` から鍵を外すと、同じカードを開いても
   「詳細を取得できませんでした」(`plan.placeIntelligence.unavailable`)だけが出ることを
   確認する(`loadPlaceIntelligence` が `placeIntelligenceProvider == nil` を `.unavailable`
   として即座に返す道と同じ結果になる)。

## 9. 近くの宿(hotel-recommendations)

合成の根(`TripCheckApp.init`)は非 UI テストのとき常に
`HotelRecommendationAvailability.makeDefaultProvider(uiTesting:client:)` が返す
`WorkerHotelRecommender` を `PlannerStore` に渡す(`-uiTesting` は nil のまま —— 「近くの宿」
シートは決定的に「候補が見つかりませんでした」になる、これが UI 回帰テストの前提)。カードの
入口自体は経路アンカーの有無(`hotelRecommendationsAvailable` = scheduled stops がある)で
決まり、Worker の疎通とは別の条件 —— 停留所が 1 つも組まれていない旅程にはカードそのものが
出ない。

1. 上の 1・2 と同じく `.dev.vars` に実 `GOOGLE_PLACES_API_KEY`(Places API が有効な
   キー)を置き、`pnpm dev` を起動。Simulator は `TRIPCHECK_WORKER_BYPASS_TOKEN` を
   `.dev.vars` と同じ値にして走らせる(`-uiTesting` は付けない)。
2. 旅程を組み、旅程の後ろの方(出発前チェックの直前)にある破線の「近くの宿」カード
   (`plan.suggestedHotels`)をタップする。下からシートが開き、初回だけ経路全体(全日の
   重心)に近い宿の取得が走り、名前・評価・経路からの外れ幅・住所を持つ候補カードが並ぶこと
   (`plan.hotelCandidate`)を確認する。カードをタップすると Google マップの該当宿へ
   遷移すること。
3. Worker を止める、または `.dev.vars` から鍵を外すと、同じカードを開いても候補は 1 件も
   出ず、「候補が見つかりませんでした」だけが出ることを確認する
   (`beginHotelFetch` が `hotelRecommendationProvider == nil` を `.unavailable` として
   即座に返す道と同じ結果になる)。

## 10. 空き時間の寄り道(route-recommendations)

合成の根(`TripCheckApp.init`)は非 UI テストのとき常に
`RouteDetourAvailability.makeDefaultProvider(uiTesting:client:)` が返す
`WorkerRouteDetourRecommender` を `PlannerStore` に渡す(`-uiTesting` は nil のまま ——
「空き時間の寄り道」シートは決定的に「候補が見つかりませんでした」になる、これが UI 回帰
テストの前提)。カードの入口自体はその日の空きの有無(`gapDetourAvailable(dayIndex)` =
`bundle.gaps[dayIndex]` が非 nil、その日でいちばん埋める価値のある 30 分以上の空き)で決まり、
Worker の疎通とは別の条件 —— 空きが 30 分未満しかない日にはカードそのものが出ない。

1. 上の 1・2 と同じく `.dev.vars` に実 `GOOGLE_PLACES_API_KEY`(Places API が有効な
   キー)を置き、`pnpm dev` を起動。Simulator は `TRIPCHECK_WORKER_BYPASS_TOKEN` を
   `.dev.vars` と同じ値にして走らせる(`-uiTesting` は付けない)。
2. 旅程を組み、空きのある日を選んだ状態で旅程の後ろの方(出発前チェックの直前、
   「近くの宿」カードのすぐ後ろ)にある破線の「空き時間の寄り道」カード
   (`plan.gapDetour`)をタップする。下からシートが開き、初回だけその空きの経路区間
   (直前・直後の停留所の座標)に近い候補の取得が走り、名前・種別・評価・経路からの
   外れ幅(m)・住所を持つ候補カードが並ぶこと(`plan.detourCandidate`)を確認する。
   カードをタップすると Google マップの該当地点へ遷移すること。
3. Worker を止める、または `.dev.vars` から鍵を外すと、同じカードを開いても候補は 1 件も
   出ず、「候補が見つかりませんでした」だけが出ることを確認する
   (`beginGapDetourFetch` が `routeDetourProvider == nil` を `.unavailable` として
   即座に返す道と同じ結果になる)。
