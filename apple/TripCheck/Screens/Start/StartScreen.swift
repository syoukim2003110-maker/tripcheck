import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 旅の入口。**行きたい場所だけ**を 1 件ずつ入れれば組める形にしてあり、日数・日付・国・
/// ホテル・ペースはどれも「決めなくてよいこと」として下に畳んである。
///
/// 主ボタンは画面の下に貼り付けたまま(`safeAreaInset`)—— 場所を 12 件入れて下まで
/// 転がしても、次の一手が視界から出ない。
struct StartScreen: View {
  @Environment(PlannerStore.self) private var store
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var suggestions = AppleSuggestions()
  @Environment(WorkerSuggestions.self) private var webSuggestions

  var body: some View {
    @Bindable var store = store
    let text = Copy.for(store.request.locale)
    let app = AppCopy.for(store.request.locale)

    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        BrandHeader(locale: store.request.locale, destination: store.request.destination)

        // 続きから始める道(組みかけの旅程・端末に残っている旅程)。何も無ければ 1 行も
        // 出ないので、初めての旅行者の画面は入力欄から始まる。
        RecentTripsSection()

        Text(app.startTitle)
          .tcFont(.screenTitle)
          .foregroundStyle(Tokens.Color.ink)

        VStack(alignment: .leading, spacing: 8) {
          PlaceSearchField(suggestions: suggestions, webSuggestions: webSuggestions) { name, suggestion in
            Task { await store.addEntry(text: name, suggestion: suggestion) }
          }
          .disabled(!store.canAddEntry)

          Text(app.startHelpShort)
            .tcFont(.body)
            .foregroundStyle(Tokens.Color.muted)
        }

        if !store.request.entries.isEmpty {
          VStack(spacing: 10) {
            ForEach(store.request.entries) { entry in
              WishlistRow(
                entry: entry,
                locale: store.request.locale,
                onPriority: { store.setPriority(id: entry.id, $0) },
                onEdit: { store.view.editingEntry = entry.id },
                onRemove: { store.removeEntry(id: entry.id) }
              )
            }
          }
        }

        Button(app.pasteText) { store.view.pasteOpen = true }
          .buttonStyle(.secondaryPill)
          .tcFont(.body)

        DaysPicker(days: $store.request.tripDays, locale: store.request.locale)

        DisclosureCard(title: app.dateDisclosure) {
          DatePickerRow(date: $store.request.tripStartDate, locale: store.request.locale)
        }

        DestinationPicker(
          choice: Binding(
            get: { store.request.destination },
            set: { choice in
              store.setDestination(choice)
              suggestions.setRegion(store.destinationBounds)
              webSuggestions.configure(destination: choice, locale: store.request.locale)
            }
          ),
          locale: store.request.locale
        )

        DisclosureCard(title: app.customDisclosure) { CustomOptions() }

        Button {
          store.loadSample(.switzerland)
          Task { await store.build() }
        } label: {
          HStack(spacing: 8) {
            IconView(.spark, size: 16, color: Tokens.Color.accent)
            Text(text.sample).tcFont(.body)
          }
        }
        .buttonStyle(.secondaryPill)
        .accessibilityIdentifier("start.seeExample")
      }
      .padding(20)
    }
    .background(Tokens.Color.bg)
    .scrollDismissesKeyboard(.interactively)
    // 検索窓は画面と同い年(`@State`)なので、`RootView` が `.start` へ戻るたびに新品に
    // なる —— 国が既に決まっている旅で戻ってきたときに世界中を探し直さないよう、
    // 出てきた時点でも箱を渡す。国を選んだ瞬間に渡すのは `DestinationPicker` の側。
    .task {
      suggestions.setRegion(store.destinationBounds)
      webSuggestions.reset()
      webSuggestions.configure(destination: store.request.destination, locale: store.request.locale)
    }
    // 端末に残っている旅程は**画面が出るたびに**読み直す。読むのがこの画面の仕事なのは、
    // 一覧を出す節(`RecentTripsSection`)が空のときに view を 1 つも作らないから ——
    // 作られない view に付けた `.task` は走らず、一覧は永久に空のままになる。
    .task { await store.loadRecent() }
    .sheet(isPresented: $store.view.pasteOpen) { PasteImportSheet() }
    // 開いている行は id で覚える。行そのものを覚えると、シートの中で条件を変えた瞬間に
    // 「持っている行」と「リストの行」がずれる —— シートは id から毎回引き直す。外された
    // 行は `get` が nil を返し、シートはひとりでに閉じる。
    .sheet(item: Binding(
      get: { store.request.entries.first { $0.id == store.view.editingEntry } },
      set: { store.view.editingEntry = $0?.id }
    )) { entry in
      EntryEditSheet(entryID: entry.id)
    }
    .safeAreaInset(edge: .bottom) {
      VStack(spacing: 8) {
        // 場所を 12 件足そうとしたときの上限トーストなど(`PlannerStore+Start.swift`)は
        // この画面にしか出番が無い —— `PlanScreen` へ渡る前にここで見せる。CTA の真上に
        // 置くのは押した指がまだ画面の下にあるうちに文言が目に入るように(`PlanScreen`
        // と同じ配置)。`.id(toast.id)` は 2 つ目のトーストでも `ToastView.onAppear` の
        // 読み上げが必ず走るように要る。ボタン自身の `.padding` / `.background` は元のまま
        // 動かさない —— 外側の VStack へ移すと `safeAreaInset` が確保する高さが変わり、
        // スクロール内の「サンプルを見る」ボタンとこの CTA が重なって、タップが CTA に
        // 吸われてしまった(UI テストで実測)。
        if let toast = store.view.toast { ToastView(toast: toast).id(toast.id) }
        Button {
          Task { await store.requestBuildFromStart() }
        } label: {
          Text(store.startCTA.label)
            .tcFont(.stats)
            .frame(maxWidth: .infinity)
            .frame(height: Tokens.Hit.primary)
        }
        .buttonStyle(.primaryAccent)
        .disabled(!store.startCTA.enabled)
        .padding(16)
        .background(.ultraThinMaterial)
        .accessibilityIdentifier("start.build")
      }
      .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: store.view.toast)
    }
  }
}

/// 上端の名札。行き先が決まっていれば、その国の名前を添える(Web `TripPlannerShell.tsx:1697`)。
private struct BrandHeader: View {
  let locale: PlannerLocale
  let destination: DestinationChoice

  var body: some View {
    // 名札は**語の途中で折らない**。決め打ちの横並びのままだと、accessibility5 で
    // 「TripChe / ck」と割れ、但し書きが 1 行目の右にぶら下がった(シミュレータで撮った)。
    // 横に入らなければ 2 段に落とし、それでも入らなければ字のほうを縮める。
    ViewThatFits(in: .horizontal) {
      HStack(alignment: .firstTextBaseline, spacing: 8) { wordmark; note }
      VStack(alignment: .leading, spacing: 4) { wordmark; note }
    }
  }

  private var wordmark: some View {
    Text(verbatim: "TripCheck")
      .tcFont(.display)
      .foregroundStyle(Tokens.Color.ink)
      .lineLimit(1)
      .minimumScaleFactor(0.5)
  }

  private var note: some View {
    Text(Copy.for(locale).brandNote(destinationName))
      .tcFont(.meta)
      .foregroundStyle(Tokens.Color.muted)
      .fixedSize(horizontal: false, vertical: true)
  }

  /// `auto` と `worldwide` は国の名前を出さない —— Kit の `brandNote` は空文字を渡すと
  /// 国名の無い言い回しに畳む。
  private var destinationName: String {
    guard case .destination(let id) = destination, id != .worldwide else { return "" }
    return Destinations.name(Destinations.byId(id), locale: locale)
  }
}

#Preview {
  RootView()
    .environment(PlannerStore(resolvers: [CatalogResolver()], store: nil))
    .environment(WorkerSuggestions(client: CannedWorkerClient()))
}
