# 海外旅行ペインポイント・ロードマップ(2026-08-08)

Claude作成。目的: 「実際に海外旅行をした人にしかわからない不便」を一次情報でリサーチし、
競合が解決できていない領域に絞って TripCheck の次の機能群を定義する。
**このファイルは実装の進捗トラッカーを兼ねる**(Claudeのトークン切れ時はCodexが
「実装状況」節から引き継ぐこと)。

---

## Executive Summary（2026-08-08 Codex再調査・引き継ぎ）

Claudeの調査・実装は、入国手続き、祝日、為替、交通上の注意など「旅程ができた後の事故防止」を
かなり前進させた。一方、TripCheckの出発点である「行きたい場所はあるが、位置・日数・空港・ホテルを
一つの成立する旅行へ変換する下処理が面倒」という**予約前の計画負担**は、ロードマップの中心に
置かれていなかった。

再調査後の製品定義は次とする。

> **TripCheckは旅行を勝手に作るAIではない。行きたい場所を、実際に使える時間・地理・空港・ホテル・
> 予約条件に通し、「全部なら最低何日」「今の日数なら何を変えるか」を返す旅行前処理エンジンである。**

重要な競合修正もある。Tripomaticは2026年時点で、shortlistの複数日配分、busy scheduleの修正、
ホテル、営業時間、滞在時間、複数交通手段を公式に掲げている。Wanderlog、Mindtrip、Googleの
Ask Maps / AI Modeも広い。したがって「wishlistを地図付き旅程にする」「当日リプランがある」だけを
差別化とするのは不正確である。残差は、以下を**同じ時間予算で反実仮想比較**することに絞る。

1. 空港到着後・出発前の実質可処分時間
2. 希望全件を守る最小必要日数
3. 日数を増やさない場合の、Must・予約を守った見直し候補
4. 空港・便・ホテルを変えた場合に取り戻せる時間と増える費用
5. 営業時間・予約期限・移動手段まで含む成立／不成立と、その理由

この引き継ぎで最初の縦切りとして、外部APIやAIを追加せず、既存の解決済みPOI・経路・滞在時間を
日数別に再計算する `lib/trip-scenarios.ts` を実装した。結果画面は、各日の実質利用可能時間、
最低必要日数、追加日数、見直し候補を先に表示する。Must・予約・固定時刻は削除候補にしない。

次の優先順位は、(1)この判定の実ユーザー検証、(2)空港・便候補比較、(3)旅程加重ホテル比較、
(4)公式情報に限定した施設予約期限である。P4(c)の広域AI運休検索やP5当日リプランより先に、
予約前の成立判定を完成させる。

---

## 1. リサーチ結果の要約

### 1-a. 体験者の生ペイン(頻度×深刻度で上位のもの)

**旅程崩壊級**(空港で詰む・その日が消える):

| ペイン | 具体例 | 出典 |
|---|---|---|
| 電子渡航認証を知らずに搭乗拒否寸前 | ESTAをチェックイン時に指摘され締切1分前に取得。**経由国の認証(バンクーバー乗継のカナダeTA)が特に盲点** | [note体験記](https://note.com/note_0624/n/n7a687b53d658), [hirschton](https://hirschton.com/esta-wasureta/) |
| タイTDAC(2025年義務化)等の新制度をそもそも知らない | 到着72時間前から申請、知らないと空港で詰む | [タイ国政府観光庁](https://www.thailandtravel.or.jp/tdac/) |
| パスポート「残存期間」ルールで当日出国不可 | 期限内でも残存6ヶ月未満でビザ免除が適用されない。日本の「期限内なら使える」感覚が仇に | [Skyscanner](https://www.skyscanner.jp/destinations/advice/passport-validity-rule) |
| 人気観光地の当日券消滅 | サグラダファミリアは当日券なし・窓口では前売も買えない | [カタルーニャ観光](https://www.catalunya-kankou.com/blog/sagrada-familia-tickets-sold-out.php) |
| 仏伊の交通スト直撃 | ミラノ移動日にスト→急遽延泊。伊は「運行保証便」制度を知らないと動けない。調査の交通トラブル実例1位 | [体験記](https://netotas.net/milano-centrale), [All About調査](https://news.allabout.co.jp/articles/o/64216/) |
| 空港の白タク・偽配車アプリ | JFK(総領事館が注意喚起PDF)、ホーチミンの偽アプリ誘導 | [在NY総領事館](https://www.ny.us.emb-japan.go.jp/files/100517549.pdf) |
| 日本の薬がそのまま違法物 | FDA未認可薬は処方箋があっても米国没収。一包化調剤は「正体不明の錠剤」扱い | [在日米国大使館](https://jp.usembassy.gov/ja/bringing-items-into-the-us-ja/) |

**罰金・金銭ロス級**:

| ペイン | 具体例 | 出典 |
|---|---|---|
| イタリア紙切符の刻印忘れ→罰金€56 | 抜き打ち検札・言い逃れ不可・車内に複数被害者。「改札がある=刻印不要」という日本の常識が概念ごと通じない | [体験ブログ](https://oyuyusan.hatenablog.com/entry/2022/09/30/230346) |
| DCC(通貨選択)で円建てを選ぶと3〜10%損 | 店頭でもATMでも「日本円で払えます」は罠。現地通貨選択が正解と知らない人が大半 | [Impress Watch](https://www.watch.impress.co.jp/docs/series/suzukij/1200785.html) |
| 日本発行クレカの海外手数料約2.2%+DCCの二重取り | JCB通用度・磁気/PIN問題も | [手数料ガイド](https://motimono-list.com/kaigai-credit-card-tesuryo.html) |
| キャッシュレス強制と現金オンリーの両極 | スウェーデンは現金拒否店あり、ドイツは屋台・個人店が現金オンリー | [swetabi](https://swetabi.com/cashless), [Wise](https://wise.com/jp/blog/cash-or-card-in-germany) |

**時間をじわじわ失う級**:

| ペイン | 具体例 | 出典 |
|---|---|---|
| ドイツ「閉店法」=日曜ほぼ全店休業 | 日曜に買い出し・土産予定→丸一日空振り | [SimVoyage](https://simvoyage.net/europe/germany/germany-sunday-guide/) |
| パリ美術館の月曜組/火曜組休館 | 統一ルールなし施設ごと。臨時休館も重なる | [パリ休館日ガイド](https://franceparisinfo.hatenablog.com/entry/paris-museum-closed-days) |
| eSIMは現地到着後の設定だと詰む | プロファイル追加自体に通信が必要。出発前インストール+**データローミングON**が鉄則(日本の常識と逆) | [note体験記](https://note.com/lively_eider3373/n/n096020f5abd5), [トリファ](https://www.trifa.co/ja/column/e-sim/esim-not-connecting) |
| 欧州の電車ドアは自動で開かない/有料トイレの小銭 | ボタン開扉を知らず降りられない等 | [Redditまとめ](https://www.yahoo.com/lifestyle/articles/world-travelers-revealing-absolute-dumbest-220733418.html) |

定量: 直近の海外旅行でトラブル経験48.9%、TOP3は言葉・予算オーバー・交通遅延/キャンセル([KDDI調査](https://prtimes.jp/main/html/rd/p/000000108.000097141.html))。

### 1-b. 競合の再検証と、残る領域（2026-08-08更新）

旧版の「全アプリが静的な清書止まり」「当日リカバリが皆無」「予約締切を教えるアプリがない」は、
一次資料で立証できず、表現が強すぎたため撤回する。Tripomaticは計画変更時の更新とbusy schedule修正、
Laylaは再計画、Ask Mapsは現在地・保存場所・リアルタイム地図情報を使う会話機能を公式に掲げる。
不在を主張するのではなく、**公開仕様で確認できた機能と、確認できなかった残差**を分ける。

| 製品 | 公式に確認できる強み | TripCheckが狙う残差（公開仕様からの推論） |
|---|---|---|
| [Tripomatic](https://tripomatic.com/en/features/ai-trip-planner) | shortlistの複数日配分、busy schedule修正、ホテル、営業時間、滞在時間、複数交通手段 | 入国・荷物・空港アクセス後の可処分時間、全件の最小追加日数、Mustを守った削除案の定量比較 |
| [Wanderlog](https://help.wanderlog.com/hc/en-us/articles/13545624787867-Optimize-route) | 予約・フライト・ホテル・地図・共同編集・費用。Route Optimizerは一日に入れた場所の順序最適化 | 日付未割当の全wishlistから必要日数を先に算出し、空港・ホテルも同じ制約に入れること |
| [Google Maps / Travel](https://blog.google/products-and-platforms/products/maps/ask-maps-immersive-navigation/) | Ask Mapsの会話型検索・地図・ETA、Flights/Hotels/AI Modeの候補比較 | Flights・Hotels・Mapsを一つの旅行容量判定に接続し、選択差を「観光時間の増減」で示すこと |
| [Mindtrip](https://mindtrip.ai/) | 画像・PDF・Google Pinsから旅程化、フライト・ホテル、共同計画 | 「この日数では何時間不足」「最低何日」「何を外すと成立」の説明可能な制約計算 |
| [TripIt](https://help.tripit.com/en/support/solutions/articles/103000063396-tripit-or-tripit-pro-) | 予約後の整理、フライト通知、空港へ出る時刻、代替便 | 予約前のwish list成立判定と、便・空港・ホテルの選択比較 |
| [Rome2Rio](https://www.rome2rio.com/about/) | A-to-Bのdoor-to-door交通手段・時間・費用 | 複数POIの営業時間・滞在・優先度を日数へ配分すること |

よって、現在の差別化候補は次の5点に限定する。

1. **Trip Capacity** — 使える総時間と必要総時間を比較し、最小日数を出す
2. **Arrival-to-Experience Envelope** — 着陸からホテル・最初のPOIまでを観光時間から引く
3. **What must give?** — 日数追加、場所削除、空港変更、ホテル変更、タクシー利用の改善量を並べる
4. **Itinerary-weighted Stay Base** — 「中心」ではなくユーザーの旅程全体への移動負担でホテルを比べる
5. **Explainable feasibility** — 営業時間・予約・移動・体力のどの制約で不成立かを数値と出典で示す

競合ページはマーケティング上の公称機能であり、全パターンを実機検証した証明ではない。特に
Tripomaticは今後のベンチマーク対象とし、定期的に実機比較する。

### 1-c. データソース実現性(検証済み)

| ソース | 判定 | 要点 |
|---|---|---|
| Nager.Date 祝日API | **使える** | `https://date.nager.at/api/v3/PublicHolidays/{year}/{countryCode}`。キー不要・CORS可・2026年データ確認済み。v4(`nagerholidays.com`)への移行が進行中だがv3現役 |
| Google Places 特定日営業時間 | 不可 | `currentOpeningHours`は7日先まで。数週間先は週次パターン(実装済み)+祝日を自前で重ねるしかない |
| 入国電子申請API | 無料は存在せず | **静的テーブル+公式リンクが現実解**(下記2-bに最新値を反映済み) |
| パスポート残存期間API | 無料は存在せず | 静的テーブル+[MOFA](https://www.anzen.mofa.go.jp)/[IATA](https://www.iatatravelcentre.com)リンク |
| ストカレンダー | 伊のみ構造化 | [MIT scioperi](https://scioperi.mit.gov.it/mit2/public/scioperi)(公式・1日2回更新)。仏SNCF/独DBは告知ページのリンク提示まで |
| 為替 | **使える** | [Frankfurter](https://frankfurter.dev/) v2(キー不要・201通貨)、フォールバック [open.er-api.com](https://open.er-api.com/v6/latest/JPY)(要帰属・24h更新) |

入国電子申請の2026-08時点の確定値(コード化する):
ESTA **US$40.27**(72時間前推奨・有効2年) / 英ETA **£20**(2025年1月から日本人必須・有効2年) /
**ETIAS未開始**(2027年開始有力→「現時点では不要」と表示するのが正) / 韓K-ETA **2026-12-31まで日本人免除** /
タイTDAC 無料・**到着72時間前から** / 星SGAC 無料・**到着3日前から** / 豪ETA AU$20(アプリのみ) /
加eTA CA$7(**乗継でも必須**) / NZ NZeTA NZ$17+**IVL NZ$100**。

---

## 2. 機能ロードマップ(優先度順)

設計原則: TripCheckの差別化は「**検証済みであること**」(引用・実測・日付)。新機能も
「一般論の助言」ではなく「**あなたの旅程のこの日・この場所に対する検証結果**」として出す。

### P0-A. Trip Capacity（必要日数・実質可処分時間・見直し候補）

- **何**: 行きたい場所を順不同で受け取り、空港到着後の開始時刻、空港へ向かう最終時刻、ホテル往復、
  滞在時間、区間移動、旅のペースを同じ時間予算に入れる。「全部なら最低何日」「今の日数では
  何時間／何か所不足」「日数を増やさないならどの場所を見直すか」を一画面で出す。
- **実装**: `lib/trip-scenarios.ts` が同じ解決済み入力を1〜14日で決定論的に再計算する。
  日の終了指定がない場合は、比較上の仮定として22:00を使い、UIにも明示する。外部API・AI・
  サーバ保存・人手確認は追加しない。
- **保護ルール**: Must、予約、固定時刻は削除候補にしない。通常優先同士の価値はシステムが
  勝手に決めず、候補と回復時間を示して選択を旅行者へ返す。
- **次**: 「日数を増やす」案と「今の日数」案を並べる比較プレビュー、移動削減を含む回復時間、
  ゆったり／バランス／最大限の3案を追加する。

### P0-B. Airport Time Value（時間比較v1実装済み）

- 入国・荷物・保安・搭乗バッファ、空港アクセス、ホテル到着、最終日の出発時刻を引き、
  ユーザーが見つけた便候補ごとの「実質観光時間」を比較する。航空券検索・価格取得は対象外とする。
- 例: 「HND便はNRT便より観光時間が2時間18分増える」。標準／慎重の2シナリオで
  不確実な入国・荷物時間を扱い、確定値のように見せない。
- **v1実装**: ユーザーが見つけた到着／出発候補を2件ずつ入力し、「主要市街地で動ける時刻」または
  「主要市街地を出る時刻」を比較する。価格・空席・手荷物・遅延は未取得と常時表示し、最安・最良とは
  呼ばない。同一都市圏（羽田／成田など）だけを比較し、未入力時刻は補完しない。選択した候補だけを
  正式な旅程へ反映する。次は標準／慎重バッファ比較とホテルまでの実測経路。

### P0-C. Itinerary-weighted Stay Base（既存ホテル機能を拡張）

- 既存のホテル候補を、全POIへの総移動、空港往復、乗換、徒歩、価格で反実仮想比較する。
- 「一泊¥4,000高いが、旅行全体で2時間15分短縮」のように、星・中心地・直線距離だけでなく
  旅行者自身の旅程への効果を出す。
- ホテル移動案は、短縮時間からチェックアウト・荷物預け・再チェックインの負担を引いて判定する。

### P0-D. Reservation Readiness（P2の未完部分を再配置）

- 検証済みPOIに `bookingPolicy / saleOpensAt / recommendedBy / finalEntry / sourceUrl /
  verifiedAt` を持たせ、施設単位の販売開始・予約推奨・最終入場を日付入りタスクにする。
- まず東京の予約必須5〜10施設を公式サイトだけで作る。AI検索や口コミから締切日数を推測しない。

### P1. 祝日インテリジェンス(旅程日×祝日の衝突検知)

- **何**: Nager.Date から旅程期間の祝日を取得し、(a)日タブに祝日バッジ、(b)祝日と重なる日に
  「祝日: Assumption Day。美術館・商店の休業/短縮に注意」警告、(c)ドイツ型の
  日曜閉店法がある国では日曜日に買物系警告。営業時間の週次パターン(既存)が祝日には
  当てにならないことを明示するのが目的。
- **実装**: `lib/holidays.ts`(fetch+パース+検証、weather.tsと同型)、`app/api/holidays/route.ts`
  (same-originガード・no-store・24hキャッシュ可)、`lib/destinations.ts` に
  `sundayClosing: boolean`(独・墺・スイスtrue)追加。クライアントは weather-client と同型。
- **テスト**: パース境界(不正JSON/空配列/年跨ぎ)、日付一致ロジック。

### P2. 出発前デッドライン・タイムライン(T-minusチェックリスト)

- **何**: 旅行日程から逆算した「日付入り」チェックリスト。
  - 入国認証: 上記2-b確定値を `lib/destinations.ts` の `entryAuthority` として構造化
    (名称・料金・申請可能時期・推奨締切・公式URL・**乗継でも必要か**)。
    旅程の出発日から「ESTA: 8/25までに申請(公式$40.27)」と実日付で出す。
  - パスポート残存: 目的地の要求(6ヶ月/3ヶ月/滞在期間)を registry に追加。
    ユーザーがパスポート期限を入力(localStorage・サーバー送信しない)すれば
    「帰国日時点で残存5ヶ月→タイは6ヶ月必要=**更新が必要**」まで判定。
  - 実証データ連動: fresh-voicesの売切れ・行列報告がある stop は「事前予約を(< 出発X日前)」
    を締切化(競合未解決領域3への直撃)。
  - eSIM: 「出発前にプロファイル追加+ローミングON」を固定項目に(理由付き)。
- **実装**: `lib/pre-trip-timeline.ts`(純関数: plan+destination+passportExpiry → dated items)、
  before-you-goパネルを時系列表示に拡張。日付計算のテスト必須(境界: 出発72時間前/3日前の丸め)。

### P3. お金の罠カード(国別マネープロファイル+為替)

- **何**: essentials に「現金 vs カード実情」(スウェーデン=現金拒否あり/独=屋台現金のみ)、
  **DCC警告**(「『日本円で払う』は3〜10%損。必ず現地通貨を選ぶ」)、ATM手数料の要点、
  日本発行カード2.2%手数料の注意。+ Frankfurterで当日レートを表示し
  「€10 ≈ ¥1,630」の暗算テーブルを印刷シートに載せる。
- **実装**: `DestinationEssentials` に `money` 節を追加、`lib/fx-rates.ts`+`app/api/fx/route.ts`
  (Frankfurter主・er-apiフォールバック・6hキャッシュ)。

### P4. 交通の罠+スト・運休ウォッチ

- **何**: (a) essentials に `transitTraps`: 伊=刻印義務(罰金€56の実例つき)、欧州=ドア手動開扉、
  検札方式、白タク注意(JFK/ホーチミンの手口)。(b) 伊旅程には [MIT scioperi](https://scioperi.mit.gov.it/mit2/public/scioperi) への
  直リンク+「旅程期間中のスト予定を確認」項目を before-you-go に。(c) AI運休チェック:
  fresh-voicesと同じweb_search基盤で「{目的地}{期間} strike / closure / 運休」を検索し、
  該当日に引用付きアラート(Gornergrat運休検知の実績パターンを一般化)。
- **実装**: (a)(b)は registry 拡張のみ。(c)は `lib/disruption-check.ts` + 専用プロンプト
  (fresh-voices.tsの`server_tool_use`パーサを流用)。

### P5. 当日リプランナー(最重量・Codex向け設計のみ)

- **何**: 競合最大の空白。実行日に「臨時休業/雨/遅延で崩れた」ときに、訪問済みstopを
  チェックオフ→残り時間+Routes実測で残りを再構成する「今日モード」。
- **設計メモ**: 既存の buildPlan は全日再構築なので、`rebuildDay(dayIndex, remainingStops,
  currentTime, currentLocation)` の単日版を trip-builder に切り出すのが正道。
  UIは日タブに「今日はここから再計算」ボタン。雨天時は屋内タグ(museum/gallery/aquarium等の
  placeTypes)を優先するヒューリスティック。**Claudeは着手しない**(トークン見積り超過)。

### P6. 薬・医療の持込みリンク集(小・静的)

- essentials に「薬の持込み」行: 米=FDA未認可薬は処方箋があっても没収の可能性
  ([米大使館](https://jp.usembassy.gov/ja/bringing-items-into-the-us-ja/))、
  一包化は避け元箱+説明書きで、向精神薬成分は事前許可制の国あり
  ([厚労省](https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/iyakuhin/yakubuturanyou/index_00005.html))。
  判定はせずリンク提示に留める(誤案内リスク回避)。

---

## 3. 実装状況(進捗トラッカー — 実装者が更新すること)

| # | 状態 | 担当 | メモ |
|---|---|---|---|
| P0-A Trip Capacity | **初期縦切り完了**(2026-08-08) | Codex | `lib/trip-scenarios.ts`。1〜14日を同じ解決済み入力で再計算し、実質利用時間・最低日数・追加日数・見直し候補を表示。Must/予約/固定時刻を保護し、予約・営業時間衝突がある案を「収まる」と判定しない。未解決／利用不可が1件でもあれば日数・余白・削除の結論を保留し、8件以上の制約付き順序はヒューリスティックへ逃がしてUI停止を防止。次は2案プレビューと削除時の回復時間 |
| P0-B 空港・便比較 | **時間比較v1完了**(2026-08-08) | Codex | `lib/airport-comparison.ts` + `app/AirportOptionComparison.tsx`。同一都市圏の到着後市内可動時刻／出発前市内離脱時刻を2候補で比較し、そのまま旅程入力へ採用できる。未入力時刻は補完せず、価格・空席・遅延は取得対象外と明示。深夜到着は活動日・営業時間・経路日時を翌日に繰越。次は慎重バッファとホテル実測を候補比較にも反映 |
| P0-C ホテル効果比較 | **一部実装** | Claude/Codex | 旅程加重の候補順位と日別ホテルは存在。時間短縮額、空港、荷物移動ペナルティの反実仮想比較は未実装 |
| P0-D 施設予約期限 | **未着手** | Codex | 現在のwatchlistは「売切れ報告あり」の名前表示のみ。施設ごとの公式販売開始・締切データはない |
| P1 祝日 | **完了**(2026-08-08) | Claude | `lib/holidays.ts`+`/api/holidays`+`lib/holidays-client.ts`+日タブ「祝」バッジ+日サマリー警告+DACH日曜警告(`sundayClosing`)+印刷シート。tests/holidays.test.ts 7件。Nager.Date実レスポンス形も照合済み |
| P2 デッドライン | **一部完了**(2026-08-08) | Claude/Codex | 入国認証・パスポート期限は実装済み。旅券国を「日本／その他／未選択」で明示し、日本以外・未選択では個別判定を停止。6か月at-entryは入国日、beyond-stayは出国日を基準にし、発行10年以内など未入力条件が残る場合はOKと断定しない。施設ごとの予約締切とeSIM固定項目、他国旅券の個別判定は未実装 |
| P3 お金 | **完了**(2026-08-08) | Claude | `money`をessentials 9カ国に追加、`lib/fx-rates.ts`+`/api/fx`(GET, Frankfurter→er-apiフォールバック, 6hキャッシュ)+`lib/fx-client.ts`、基本情報カードに「支払い」「為替の目安」行+DCC警告固定文。tests/fx-rates.test.ts 4件。**注意: 同一オリジンGETはOriginヘッダが付かないため、GETルートのsameOriginは「Origin無し=許可+Sec-Fetch-Site拒否」にしてある**(最初403で為替行が消えるバグを踏んだ) |
| P4 交通の罠+スト | **完了(a)(b)**(2026-08-08) | Claude | `transitTraps`9カ国(伊の刻印€50+、DACH/仏のボタン開扉、英のタッチ入出場、米/越/泰の白タク・偽配車)+`strikeInfo`3カ国(伊MIT scioperi/仏SNCF/独DB)を出発前チェックに表示。**(c)AI運休チェックは未着手→CodexへFI**: fresh-voicesの`server_tool_use`パーサ流用で「{destination}{期間} strike/closure」を検索し該当日にアラート。Gornergrat検知の一般化 |
| P5 当日リプランナー | **未着手** | **Codex**(設計メモ§2-P5) | |
| P6 薬リンク | **完了**(2026-08-08) | Claude | 出発前チェックに固定行(元箱携行・一包化リスク・向精神薬・米FDA没収)+厚労省リンク。判定はせずリンク提示のみ |

### 実機確認済み(2026-08-08, スイス12/24〜27の実ビルドで確認)

日タブ「祝」バッジ(12/25・12/26)、日サマリーの祝日警告「祝日「Weihnachten」—美術館・商店は休業・短縮営業の可能性」、12/27(日)の閉店法警告、出発前チェックのETIAS/薬/残存期間項目、パスポート期限2027-02-01入力→「要対応・2027-03-27まで必要」のブロッカー表示、基本情報カードの支払い/交通の注意/DCC行。/api/holidays はNager実弾でBundesfeier+Maria Himmelfahrt(州限定フラグ付き)を返却、/api/fx はOriginなしGETで200を確認。

## 4. 引き継ぎ注意(Codex向け)

- テストは **Node ≥22.15 必須**(`module.registerHooks`)。`pnpm test` / `pnpm lint` /
  `pnpm build`(vinext)。再ビルド後は :3000/:8788 の `vinext start` 再起動必須。
- AI機能はローカルプロキシ(`pnpm ai:local`, :8791)+`.env` の `ANTHROPIC_BASE_URL` で
  クレジット不要で動く。P4(c)のweb_searchエミュレーションも対応済み。
- 楽天IPは 119.172.134.216 を登録済み(2026-08-08動作確認済み)。
- ブランチ `claude/critique-fixes-1`。コミットはユーザー依頼まで行わない。
- 静的データ(入国認証・残存期間)は**必ず§1-cの確定値と公式URLを使う**こと。
  特に「ETIASは未開始(2027年有力)」— 開始済みと書くと誤案内になる。

---

## 5. 旅行前の計画負担 — 市場・ユーザー課題の追加調査

### 5-a. 負担は「候補不足」ではなく、情報の分断と意思決定にある

Expedia GroupとLuth Researchの調査では、日本を含む7市場の旅行者は、予約前45日間に平均141ページ、
303分の旅行コンテンツを閲覧した。アンケート5,713人と受動計測パネル7万人超に基づく
([Expedia Group Path to Purchase](https://partner.expediagroup.com/en-us/resources/blog/path-to-purchase-insights))。
これは旅程作成だけの時間ではなく、着想・比較・予約を含むため、そのままTripCheckの削減可能時間とは
読めない。しかし、航空会社、OTA、検索、地図、SNS等へ情報が分散している強い証拠である。

Expedia Groupの2026年調査では、旅行者が同じプラットフォームで複数要素を扱いたい理由として、
時間節約44%、旅行管理の容易さ40%、one-stopの利便性39%が挙げられた
([Expedia Group, Full Trip Research](https://partner.expediagroup.com/en-us/resources/blog/global-research-reveals-how-full-trip-bookings-win-loyalty))。
同社の販売目的を含む委託調査なので割合は中立な社会統計ではないが、「別々の要素をつなぐ負担」が
利用動機になる方向はTripCheckと一致する。

### 5-b. 人はAIに候補を求めるが、判断を全面委任したくない

Booking.comが2025年に33市場37,325人へ行った調査では、AIを全面的に信頼する回答は6%、
AIの独立判断を受け入れる回答は12%だった。42%は常に、29%は時々AI出力を確認すると回答した
([Booking.com Global AI Sentiment Report](https://news.booking.com/bookingcom-releases-the-global-ai-sentiment-report/))。

Expedia Group／YouGovの2026年調査（米・英・印、5,700人超）でも、40%がAIを旅程作成に使う一方、
米英で計画時にAIへ依存する人は8%、66%はAIへの購入・予約委任を信用しない
([Expedia Group AI Trust Gap](https://ir.expediagroup.com/news-and-events/news/news-details/2026/Expedia-Group-Reveals-The-AI-Trust-Gap-Travelers-Embrace-AI-for-Planning-but-Rely-on-Trusted-Brands-to-Book/default.aspx))。

よってUIは「AIが選んだ正解」を押し付けず、次を示して最後の選択を旅行者へ返す。

- なぜ入らないか（移動、営業時間、滞在、空港、予約のどれか）
- 何日増やせば全部入るか
- 一つ外すと何分戻るか
- 空港・ホテル・交通費を変えると何時間戻るか
- どの値が実測、公式、推定、ユーザー入力か

### 5-c. 最短経路だけでは旅行は成立しない

Tourist Trip Design Problemは、POI位置、営業時間、滞在、区間移動、交通手段、旅行日数、
一日の活動時間、ユーザー価値を同時に扱う問題である
([Applied Soft Computing, 2024](https://www.sciencedirect.com/science/article/pii/S156849462400173X))。
単純な巡回セールスマン問題は「全地点を回る」前提だが、実際の旅行では時間枠内に入らない地点を
選び落とすOrienteering/TTDPが必要になる。TripCheckでは、TSPは**一日の順番**に限定し、
日への配分・採否は制約充足と優先度が所有する。

### 5-d. フライト日と観光日数は同じではない

ANAは国際線でチェックイン・手荷物預けを出発60分前、搭乗口を30分前までとしている。また条件により
羽田—成田を含む乗継に180分以上を求める
([ANA 国際線手続き](https://www.ana.co.jp/en/jp/guide/boarding-procedures/checkin/international/notice/))。
東京の公称最短例でも羽田—東京駅19分
([東京モノレール](https://www.tokyo-monorail.co.jp/english/haneda-tokyo-access/index.html))、
成田T2・3—東京駅47分（乗換を除く）
([京成電鉄](https://www.keisei.co.jp/keisei/tetudou/skyliner/us/directions/tokyo.php))である。

さらに観光庁の2025年度調査では、訪日客4,110人の10.3%が入国手続きで困り、その回答者の58%が
待ち時間・手続き時間の長さを理由に挙げた
([観光庁 受入環境調査 PDF](https://www.mlit.go.jp/kankocho/content/001998583.pdf))。
従って初日の開始は着陸時刻ではなく、

`着陸 → 降機 → 入国 → 荷物 → 空港駅 → ホテル／荷物預け → 最初のPOI`

で計算する。入国・荷物時間は便・空港・国籍等で変わるため、単一の確定値ではなく標準／慎重の
範囲で示す。

### 5-e. ホテルは旅程全体へのアクセスで評価する

ホテル立地の研究では、観光地・空港・公共交通へのアクセスが立地満足度と関連する
([Journal of Travel Research](https://journals.sagepub.com/doi/abs/10.1177/0047287517691153))。
地域や調査方法に依存するため固定の世界共通重みにはしない。製品上の示唆は、ホテルを「中心地」や
星だけで選ばず、ユーザー自身のPOI、空港、夜の帰着、荷物を含む総負担で比較することにある。

### 5-f. 予約期限・営業時間も成立条件である

JNTOは、交通・宿泊・観光に数か月前から予約が必要な場合があり、何が予約必須かは明白でないこと、
予約時刻が日本時間であること、24〜48時間前の再確認などを案内する
([JNTO Making Reservations](https://www.japan.travel/en/responsible-travel-guide/features/making-reservations/))。
営業時間も正月・Golden Week・お盆等で休業・短縮になり得る
([JNTO Business Hours and Holidays](https://www.japan.travel/en/plan/business-hours-and-holidays/))。
これらは「便利情報」ではなく、旅程に入れられるかを決めるhard/soft constraintとして扱う。

---

## 6. 統合機能像と優先順位

### 最終的な入力

- 行きたい場所（順不同、文章、URL、スクリーンショット。必須／任意を後から付けられる）
- 旅行日数または日付
- 便・空港（確定便、または比較候補。未定でも可）
- ホテル（確定ホテル、候補、エリア、未定）
- 一日の開始／終了、ペース、歩行・体力、交通の希望
- 予約済み時刻、食事制約、グループのhard constraint

### 最終的な出力

1. **全件実行案** — 希望全件を守る最小日数
2. **現在の日数案** — Must・予約を守り、何を予備へ回したかと理由
3. **時間を買う案** — 空港、便、ホテル、タクシー等を変え、何分増えるかと費用差

各案に、実質観光時間、滞在、移動（Movement tax）、余白、営業時間衝突、予約期限、
情報の出典・鮮度・確信度を出す。

### 実装順

| 順番 | Vertical slice | 成立条件 |
|---:|---|---|
| 1 | Trip Capacity v1（実装済み） | 最低日数と各日の可処分時間を追加APIなしで返す |
| 2 | Capacity比較UI | 「日数追加」と「今の日数」を横並びでプレビューし、選択を戻せる |
| 3 | Airport / Flight Value | 2空港・2便以上を、観光時間と費用の差で比較できる |
| 4 | Stay Base Counterfactual | ホテル候補変更時の総移動時間・空港時間・価格差を表示する |
| 5 | Reservation Readiness | 公式ソース付きPOIだけで、販売開始・締切・最終入場を日付化する |
| 6 | Door-to-door Mode Value | 車内時間だけでなく徒歩、待ち、乗換、荷物、人数別費用を比較する |
| 7 | Today Recovery | 現在地、残時間、訪問済み、営業中、予約をhard constraintに単日再計算する |
| 8 | Group Constraint Merge | 各人のMust・体力・食事・非公開予算を統合し、誰の条件が外れるか示す |

「P4(c) AI運休検索」は情報の誤検知と運用負荷が高いため、上の1〜5より後に置く。広域web検索の
結果をhard constraintにせず、公式運行情報へ到達するwatchlistとしてのみ扱う。

---

## 7. AIと決定論の境界（製品契約）

| AIを使う | 決定論で持つ | 外部データを取得する |
|---|---|---|
| 雑な文章・画像・URLから候補を抽出 | 日付、時刻、タイムゾーン | フライト時刻・運航状況 |
| 同名POIの候補提示 | 空港・搭乗バッファ | 交通ダイヤ・door-to-door経路 |
| 「絶対行きたい」等のニュアンス抽出 | 経路行列、地理クラスタ、順序最適化 | ホテル料金・空室 |
| 計算結果を自然に説明 | 営業時間・最終入場・滞在時間 | POI営業時間・予約条件 |
| 選択肢を理解する対話 | 日別時間予算、必要日数、優先度、費用 | 天候・混雑・運休の公式情報 |

AIは未取得の営業時間、移動時間、入国ルールを埋めてはいけない。AIの出力は候補または説明であり、
成立判定は必ず構造化値とルールから再現できること。ユーザー旅程を人間へ送る運用は採用しない。

現行の「コンセプトからAIで8〜12件を生成」は、`docs/roadmap.md` の非目標と「行きたい場所から始める」
理念に衝突している。使用実績を計測するまで主導線から外し、TripCheckの核として訴求しない。

---

## 8. 検証計画・成功指標・停止条件

市場規模や支払意思ではなく、まず本当に旅行前の負担を減らせるかを測る。旅程を人手で閲覧せず、
本人端末上の同意したイベントと匿名集計で評価する。

### 8-a. 15〜30件の比較テスト

実際に旅行を計画中の利用者が、自分の端末でフライト候補、ホテル候補、wishlistを入力する。
従来の方法で決めた案とTripCheck出力を本人が比較し、次を計測する。

- 入力開始から「納得できる案」までの時間
- 入力前には気付かなかった不成立条件数
- 必要日数見積りが変わった割合
- 空港・便・ホテルの選択を変えた割合
- 外す候補への納得度（5段階）
- 「なぜこの案か」を説明できた割合
- 出力後に追加検索したページ数
- 結果を自分で修正した割合と、修正箇所

### 8-b. 最初の品質ゲート

- 既知の営業時間・空港時刻・予約時刻に対するhard constraint違反: 0件
- 必要日数結果が同じ入力で変わる非決定性: 0件
- 旅程作成時間の中央値: 従来比30%以上短縮
- 「役に立った／非常に役に立った」: 70%以上
- 見直し候補への納得度: 平均4.0/5以上
- 不明データを確定情報のように表示した件数: 0件

利用者の50%以上が必要日数・可処分時間を意思決定に使わない、または見直し候補の納得度が3.0未満なら、
P0-B以降を広げず、入力・説明・優先度設計を再検討する。

---

## 9. 追加で判明した製品リスク（機能拡張より先に修正）

1. **製品範囲の文書不一致**: `AGENTS.md` / `docs/product.md` は東京中心、README・実装・規約は
   Worldwide beta。公開範囲を一つに決め、契約文書を揃える。
2. **国籍なしで入国ルールを表示**: 現行は世界向け英語UIでも日本旅券前提。国籍を明示選択するまで
   非表示にするか、「日本旅券の場合」をカード全体で明確にする。
3. **将来日ルールの期限処理 — 修正済み(2026-08-08)**: K-ETAの免除は
   `statusValidUntil` と旅行日を比較し、2027-01-01以降を「現在免除」と表示しない。
4. **Ireland誤分類 — 修正済み(2026-08-08)**: `IE` をUKプロファイルから外し、プロバイダが
   未対応国コードを返した場合は座標で隣国を推測せず `worldwide` にする。
5. **施設予約期限は未実装**: P2は入国・パスポートまでで、watchlistを予約締切と呼ばない。
6. **AI入力のプライバシー記載**: コンセプト生成を残すなら、Anthropic送信とサーバーメモリキャッシュを
   公開Privacyへ明記する。残さないなら主導線から撤去する。

---

## 10. 調査上まだ不明なこと（Further Questions）

- 空港選択のために観光時間を失った人の発生率
- POIの位置関係を誤認し、必要日数を過小評価した人の割合
- 旅程加重のホテル比較で実際に予約候補を変える割合
- 「あと何日必要か」と「何を外すか」のどちらがより強い便益か
- 体力・歩行・子連れ・高齢者制約をどの入力負担までなら登録するか
- 22:00の既定仮定が地域・旅行者層に適切か
- Tripomatic実機との同一入力ベンチマークで、どこまで結果差が残るか

### Caveats

- 競合の「ない」機能は、公開公式資料で確認できなかったという意味であり、全アカウント・全地域を
  実機検証した不存在証明ではない。
- Expedia、Booking.com等の定量値は旅行会社の委託・自社調査であり、設問・対象市場・商業目的を
  含む。方向性の根拠には使うが、一般人口の厳密な発生率とは扱わない。
- 学術研究は問題構造の根拠であり、TripCheckの需要規模・継続率・支払意思を証明しない。
- 現在の必要日数は、既存の滞在推定と取得済み経路の品質に依存する。結果には仮定・実測区間数・
  未確認POI数を併記し、精度を実ユーザー旅程で校正する。
