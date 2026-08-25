import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// アプリの入口。画面は常に明るい配色で出す —— 紙の上の旅程表という見立てなので、
/// 端末の暗い配色に合わせて色を反転させない。
///
/// 状態はここで 1 つだけ作り、環境に置く(`RootView` から下は全部これを読む)。保存先は
/// 端末の Application Support の下だが、**UI テストのときだけ使い捨ての場所に切り替える**
/// —— テストが自分の旅程を残して、次のテストや旅行者本人の一覧に混ざらないように。
@main
struct TripCheckApp: App {
  @State private var store: PlannerStore
  @State private var webSuggestions: WorkerSuggestions
  /// UI テストで走っているか。アニメーションを切るのに `body` の側でも要る。
  private let isUITesting: Bool
  private let isWorkerDiagnostics: Bool
  private let workerClient: any WorkerAuthenticating

  /// UI テストのときだけ使う `UserDefaults` の箱。旅程の保存先と違って**名前は固定**で、
  /// 起動のたびに中身を捨てる。
  private static let uiTestSuiteName = "com.muraoshoki.tripcheck.uitest"

  init() {
    let isUITesting = ProcessInfo.processInfo.arguments.contains("-uiTesting")
    self.isUITesting = isUITesting
    let directory = isUITesting
      ? FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
      : URL.applicationSupportDirectory.appendingPathComponent("TripCheck")
    // 旅程の保存先だけでなく**設定の置き場も**使い捨てにする。言語と旅券の有効期限は
    // `UserDefaults` に残るので、既定の箱を使うと 1 本のテストが選んだ言語で次のテストの
    // アプリが立ち上がる —— 名前は固定にして起動のたびに消す(毎回 UUID にすると、
    // シミュレータに読まれない plist が溜まり続ける)。
    let defaults: UserDefaults
    if isUITesting {
      UserDefaults.standard.removePersistentDomain(forName: Self.uiTestSuiteName)
      defaults = UserDefaults(suiteName: Self.uiTestSuiteName) ?? .standard
    } else {
      defaults = .standard
    }
    // 動きを切る。押した先が動いている最中は `XCUIElement` の位置が定まらないので、
    // テストは待つか、動いている札を掴んで落ちるかのどちらかになる。UIKit 側
    // (シート・警告の出入り)は `setAnimationsEnabled`、SwiftUI 側は `body` の
    // `.transaction` が受け持つ —— どちらか片方だけでは止まらない。
    if isUITesting { UIView.setAnimationsEnabled(false) }
    let isWorkerDiagnostics = ProcessInfo.processInfo.arguments.contains("-workerDiagnostics")
    self.isWorkerDiagnostics = isWorkerDiagnostics
    let baseURLString = ProcessInfo.processInfo.environment["TRIPCHECK_WORKER_BASE_URL"]
      ?? (Bundle.main.object(forInfoDictionaryKey: "TripCheckWorkerBaseURL") as? String)
      ?? "http://127.0.0.1:3000"
    let baseURL = URL(string: baseURLString) ?? URL(string: "http://127.0.0.1:3000")!
    let workerClient = WorkerAvailability.makeDefaultClient(
      uiTesting: isUITesting,
      baseURL: baseURL,
      bypassToken: ProcessInfo.processInfo.environment["TRIPCHECK_WORKER_BYPASS_TOKEN"]
    )
    self.workerClient = workerClient

    // 解決器は順に呼ばれ、**先に `confirmed` を返したところで止まる**。Worker(Google 検証済み)
    // が先頭に立つのは、鍵を持つ Worker が一番信頼できる情報源だから —— 未認証・オフライン・
    // 失敗・タイムアウトは空辞書を返し、次点の端末の地図(鍵ゼロで世界中の場所を知っている)へ
    // 委ねる。カタログは東京 18 + スイス 8 地点しか持たず、地図も答えられなかったぶんを
    // 受け止める最後の控えになる。
    // 保存先を 2 度渡すのは、`TripStore` が自分のディレクトリを外へ見せないから ——
    // 起動した瞬間に「この端末に残せるか」を確かめる(`storageUnavailable`)には、
    // `PlannerStore` の側も同じ場所を知っている必要がある。
    _store = State(initialValue: PlannerStore(
      resolvers: [WorkerPlaceResolver(client: workerClient), ApplePlaceResolver(), CatalogResolver()],
      store: TripStore(directory: directory),
      storageDirectory: directory,
      defaults: defaults,
      // `Locale.current` を読むのはここだけ(合成の根)。`PlannerStore.init` 自身の既定は
      // `.ja` に固定してあるので、AppCore のテストが作る 152 か所の store は機械の言語を
      // 読まない。
      initialLocale: PlannerStore.systemLocale,
      // UI テストは通信しない決定的な提供元で同じ画面遷移を踏む。
      routeProvider: isUITesting
        ? CannedRouteProvider() as any RouteProvider
        : WorkerRouteProvider(client: workerClient, fallback: AppleRouteProvider()),
      // 聞き取り係も同じ理由で UI テストは canned。可用性の判定自体は composition root
      // (`IntentAvailability`)に閉じ込めてあり、ストアは注入の有無しか見ない。
      intentParser: IntentAvailability.makeDefaultParser(uiTesting: isUITesting),
      // 天気も同じ理由で composition root にだけ判定を閉じ込める(`WeatherAvailability`)。
      weatherProvider: WeatherAvailability.makeDefaultProvider(uiTesting: isUITesting),
      // 食事の候補も同じ理由で composition root にだけ判定を閉じ込める
      // (`FoodRecommendationAvailability`)。UI テストは nil のまま —— タップした行は
      // 決定的に「候補なし」になる(`MealRow` の非回帰)。
      foodRecommendationProvider: FoodRecommendationAvailability.makeDefaultProvider(uiTesting: isUITesting, client: workerClient),
      // 近くの宿も同じ理由で composition root にだけ判定を閉じ込める
      // (`HotelRecommendationAvailability`)。UI テストは nil のまま —— シートを開いても
      // 決定的に「候補が見つかりませんでした」になる(`SuggestedHotelsCard` の非回帰)。
      hotelRecommendationProvider: HotelRecommendationAvailability.makeDefaultProvider(uiTesting: isUITesting, client: workerClient),
      // 場所の詳細も同じ理由で composition root にだけ判定を閉じ込める
      // (`PlaceIntelligenceAvailability`)。UI テストは nil のまま —— カードを開いても
      // 決定的に「詳細を取得できませんでした」になる(`PlaceIntelligenceDisclosure` の非回帰)。
      placeIntelligenceProvider: PlaceIntelligenceAvailability.makeDefaultProvider(uiTesting: isUITesting, client: workerClient),
      // 空き時間の寄り道も同じ理由で composition root にだけ判定を閉じ込める
      // (`RouteDetourAvailability`)。UI テストは nil のまま —— カードを開いても
      // 決定的に「候補が見つかりませんでした」になる(`GapDetourCard` の非回帰)。
      routeDetourProvider: RouteDetourAvailability.makeDefaultProvider(uiTesting: isUITesting, client: workerClient),
      // 最新の声も同じ理由で composition root にだけ判定を閉じ込める(`FreshVoicesAvailability`)。
      // UI テストは nil のまま —— 入れ子の「最新の声」節を展開しても決定的に空表示になる
      // (`PlaceIntelligenceDisclosure` の非回帰)。
      freshVoicesProvider: FreshVoicesAvailability.makeDefaultProvider(uiTesting: isUITesting, client: workerClient)
    ))
    _webSuggestions = State(initialValue: WorkerSuggestions(client: workerClient))
  }

  var body: some Scene {
    WindowGroup {
      if isWorkerDiagnostics {
        WorkerDiagnosticsScreen(client: workerClient)
          .preferredColorScheme(.light)
      } else {
        RootView()
          .environment(store)
          .environment(webSuggestions)
          .preferredColorScheme(.light)
          // SwiftUI 側の動きを切る(UI テストのときだけ)。`withAnimation` も暗黙の
          // `.animation` も、この 1 枚が transaction から動きを抜くので素通しになる。
          .transaction { transaction in
            guard isUITesting else { return }
            transaction.animation = nil
            transaction.disablesAnimations = true
          }
          // 共有リンクで開かれたとき。Web の `https://…#t=<code>` も、アプリの
          // `tripcheck://t/<code>` も、同じ 1 本のコードを運んでくる —— 読めなければ
          // `importShare` が何も変えずにトーストで報せる(開いていた旅程を黙って捨てない)。
          .onOpenURL { url in
            guard let code = PlannerStore.shareCode(from: url) else { return }
            Task { await store.importShare(code: code) }
          }
      }
    }
  }
}
