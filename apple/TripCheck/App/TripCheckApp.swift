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

  init() {
    let isUITesting = ProcessInfo.processInfo.arguments.contains("-uiTesting")
    let directory = isUITesting
      ? FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
      : URL.applicationSupportDirectory.appendingPathComponent("TripCheck")
    // 解決器は順に呼ばれ、**先に `confirmed` を返したところで止まる**。端末の地図が先頭に
    // 立つのは、鍵ゼロで世界中の場所を知っているから —— カタログは東京 18 + スイス 8 地点
    // しか持たず、地図が答えられなかったぶんを受け止める控えになる。
    // 保存先を 2 度渡すのは、`TripStore` が自分のディレクトリを外へ見せないから ——
    // 起動した瞬間に「この端末に残せるか」を確かめる(`storageUnavailable`)には、
    // `PlannerStore` の側も同じ場所を知っている必要がある。
    _store = State(initialValue: PlannerStore(
      resolvers: [ApplePlaceResolver(), CatalogResolver()],
      store: TripStore(directory: directory),
      storageDirectory: directory
    ))
  }

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(store)
        .preferredColorScheme(.light)
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
