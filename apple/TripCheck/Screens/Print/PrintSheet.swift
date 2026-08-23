import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 紙を渡す 1 枚。`•••` の「印刷 / PDF」から出る。
///
/// この画面が持っているのは**受け渡し**だけである。紙そのものは `TripPrintSheet`、PDF に
/// するのは `PDFExporter`、配るのは iOS の共有シート(`ShareLink`)—— そこから印刷にも、
/// 「ファイル」への保存にも、AirDrop にも送れるので、この画面が行き先を選ばせる必要は無い。
///
/// 共有(`ShareSheet`)と違ってスイッチが 1 つも無いのは、紙には**全部**載るからである。
/// 何を隠すかを選ぶ画面は、リンクのように他人の端末で開かれるものにだけ要る。
struct PrintSheet: View {
  @Environment(PlannerStore.self) private var store
  @Environment(\.dismiss) private var dismiss

  /// 書き出した PDF。開いてから 1 度だけ作る。
  @State private var file: URL?
  /// 書き出せなかった。**押せないボタンを黙って残さない**ための旗。
  @State private var failed = false

  var body: some View {
    let text = Copy.for(store.request.locale)
    let app = AppCopy.for(store.request.locale)

    NavigationStack {
      VStack(alignment: .leading, spacing: 10) {
        Text(text.printTitle)
          .tcFont(.body)
          .foregroundStyle(Tokens.Color.ink2)
          .fixedSize(horizontal: false, vertical: true)
        // 紙に何が載るかは、旅程そのものの 1 行がいちばん短く言う(画面の統計行と同じ数)。
        Text(store.statsLine)
          .tcFont(.stats)
          .foregroundStyle(Tokens.Color.ink)
        Spacer(minLength: 0)
      }
      .padding(20)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Tokens.Color.bg)
      .navigationTitle(text.print)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button(text.close) { dismiss() }
            .tcFont(.body)
            .foregroundStyle(Tokens.Color.ink2)
        }
      }
      .safeAreaInset(edge: .bottom) { handOver(app: app) }
    }
    .accessibilityIdentifier("print.sheet")
    // 開いた時点の旅程を 1 度だけ紙にする。閉じて開き直せば、そのときの旅程で作り直す。
    .task { prepare() }
  }

  // MARK: - 書き出し

  private func prepare() {
    guard file == nil, !failed else { return }
    do {
      // 紙の幅は紙のほうが持ち主。既定に頼ると、片方だけ動かしたときに黙ってずれる。
      file = try PDFExporter.render(
        TripPrintSheet(model: store.printModel, locale: store.request.locale),
        pageWidth: TripPrintSheet.pageWidth
      )
    } catch {
      failed = true
    }
  }

  // MARK: - 渡す

  /// 出来上がるまでは進み具合を、出来上がったら渡すボタンを、失敗したらその 1 行を。
  /// **3 つのうち必ず 1 つが出ている** —— 何も無い足元は、まだ作っている最中と区別が付かない。
  @ViewBuilder private func handOver(app: AppCopy) -> some View {
    VStack(spacing: 8) {
      if let file {
        ShareLink(item: file, subject: Text(store.shareSubject)) {
          Text(app.printSaveAction)
            .tcFont(.stats)
            .frame(maxWidth: .infinity)
            .frame(height: Tokens.Hit.primary)
        }
        .buttonStyle(.primaryAccent)
        .accessibilityIdentifier("print.share")
      } else {
        HStack(spacing: 8) {
          if !failed { ProgressView().tint(Tokens.Color.ink2) }
          Text(failed ? app.printFailed : app.printPreparing)
            .tcFont(.body)
            .foregroundStyle(failed ? Tokens.Color.danger : Tokens.Color.ink2)
        }
        .frame(maxWidth: .infinity)
        .frame(height: Tokens.Hit.primary)
        .accessibilityIdentifier("print.status")
      }
    }
    .padding(16)
    .background(.ultraThinMaterial)
  }
}

#Preview {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland)
  return PrintSheet()
    .environment(store)
    .task { await store.build() }
}
