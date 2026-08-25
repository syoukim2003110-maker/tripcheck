# WeatherKit 確認手順

WeatherKit は有料会員の entitlement(`com.apple.developer.weatherkit`)が要る。自動テストは
CannedWeatherProvider で回るので、本物の予報はここでだけ確かめる。

## 1. capability を有効化
Apple Developer のアプリ ID に WeatherKit を有効化し、`TripCheck.entitlements` に
`com.apple.developer.weatherkit = YES`(本計画で追加済み)。Xcode の Signing で自動プロビジョニング。

## 2. Simulator / 実機で確認
- 今日から 10 日以内の日付を持つ旅程を作る(ホライズン内でないと出ない)。
- プラン画面の日ヘッダーに天気チップ(アイコン+最高/最低℃+降水%)が出る。
- 「Apple Weather」帰属バッジが出て、タップで法的ページが開く。
- 天気が無い日(日付未定・10 日超先)はチップも帰属も出ない(仕様どおり)。

## 3. うまく出ないとき
- entitlement/プロビジョニングが有効か、旅程の日付がホライズン内か、停留所が解決済みかを見る。
- Simulator の一部構成は WeatherKit 非対応 —— その場合は実機で確認。
