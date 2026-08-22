import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 場所を確かめる画面。ここに来るのは 2 つの場合だけ —— 決まらなかった場所が 1 件でもある
/// (`review` / `unresolved`)か、決まった場所が 2 か国に散っているか。
///
/// **国が混ざったときだけ、国の選択が list の上に出る。** ふだんは逃げ道(入力へ戻る・国を
/// 選び直す)を list の下に置く: 上に置くと 139px を食い、いちばん確かめたい 1 件目が
/// 画面の下半分から始まる(Web `ResolveScreen.tsx:203-212`)。混ざったときは話が別で、
/// 自動判定が止まった理由そのものが国なので、国を選ぶことが次の一手になる。
struct ResolveScreen: View {
  @Environment(PlannerStore.self) private var store

  /// 手動ピンのシートを開いている行。**行そのものではなく id で覚える** —— シートの中で
  /// 座標を入れた瞬間に「持っている行」と「リストの行」がずれる。
  @State private var manualPin: ManualPinTarget?

  var body: some View {
    let app = AppCopy.for(store.request.locale)
    let rows = store.resolveRows
    let anchors = store.request.entries.compactMap { $0.pinned?.stop }
    let mixed = store.request.mixedCountryCodes

    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        Text(rows.contains { $0.state != .confirmed } ? app.resolveTitle : app.resolveAllConfirmed(count: store.confirmedCount))
          .tcFont(.screenTitle)
          .foregroundStyle(Tokens.Color.ink)

        if !mixed.isEmpty { escapeControls(mixed: mixed, app: app) }

        VStack(spacing: 10) {
          ForEach(rows) { row in
            ResolveRow(
              row: row,
              locale: store.request.locale,
              anchors: anchors,
              isSearching: store.isResolvingPlaces,
              onChoose: { store.chooseCandidate(entryId: row.id, candidate: $0) },
              onReject: {
                store.rejectCandidates(entryId: row.id)
                manualPin = ManualPinTarget(id: row.id)
              },
              onRetry: { Task { await store.retryResolve(entryId: row.id) } },
              onEditInput: { store.view.screen = .start },
              onPinOnMap: { manualPin = ManualPinTarget(id: row.id) },
              onRemove: { store.removeEntry(id: row.id) }
            )
          }
        }

        let unresolved = rows.filter { $0.state == .unresolved }.count
        let ambiguous = rows.filter { $0.state == .review }.count
        if unresolved > 0 { notice(app.resolveUnresolvedCount(count: unresolved)) }
        if ambiguous > 0 { notice(app.resolveAmbiguousCount(count: ambiguous)) }

        if mixed.isEmpty { escapeControls(mixed: [], app: app) }

        DisclosureCard(title: app.customDisclosure) { ConditionsSection().padding(.top, 4) }
        DisclosureCard(title: app.flightsDisclosure) { FlightsSection().padding(.top, 4) }
      }
      .padding(20)
    }
    .background(Tokens.Color.bg)
    .scrollDismissesKeyboard(.interactively)
    .safeAreaInset(edge: .bottom) {
      Button {
        Task { await store.continueFromResolve() }
      } label: {
        Text(app.resolveContinue(count: store.confirmedCount))
          .tcFont(.stats)
          .frame(maxWidth: .infinity)
          .frame(height: Tokens.Hit.primary)
      }
      .buttonStyle(.primaryAccent)
      .disabled(!store.canContinue)
      .padding(16)
      .background(.ultraThinMaterial)
      .accessibilityIdentifier("resolve.continue")
    }
    .sheet(item: $manualPin) { target in
      ManualPinSheet(entryID: target.id)
    }
    // 必須・予約が未解決のまま進もうとしたときだけ出る。「続ける」は同じ関数を `force` で
    // もう一度呼ぶ —— 進む道が 2 本に分かれない。
    .alert(
      app.mustUnresolvedTitle,
      isPresented: Binding(
        get: { blockedNames != nil },
        set: { if !$0 { store.view.pendingHardEdit = nil } }
      ),
      presenting: blockedNames
    ) { _ in
      Button(app.mustUnresolvedContinue) { Task { await store.continueFromResolve(force: true) } }
      Button(app.mustUnresolvedBack, role: .cancel) { store.view.pendingHardEdit = nil }
    } message: { names in
      Text(app.mustUnresolvedBody(names: names))
    }
  }

  /// 入力へ戻る道と、国を選び直す道。国が混ざったときだけ list の上に出る。
  private func escapeControls(mixed: [String], app: AppCopy) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      if !mixed.isEmpty {
        notice(app.resolveCountryConflict(codes: mixed))
      }

      Button(app.resolveEditInput) { store.view.screen = .start }
        .buttonStyle(.secondaryPill)
        .tcFont(.body)
        .accessibilityIdentifier("resolve.editInput")

      DestinationPicker(
        choice: Binding(get: { store.request.destination }, set: { store.setDestination($0) }),
        locale: store.request.locale
      )

      Text(app.resolveCountryHint)
        .tcFont(.meta)
        .foregroundStyle(Tokens.Color.muted)

      // 1 か国に収まらない旅のための逃げ道。国の一覧の最後にも同じ選択肢があるが、
      // 混ざったと言われた直後の旅行者に、探させない。
      Button(app.resolveWorldwide) { store.setDestination(.destination(.worldwide)) }
        .buttonStyle(.secondaryPill)
        .tcFont(.body)
        .disabled(store.request.destination == .destination(.worldwide))
    }
  }

  /// 数え上げの 1 行。件数を名指しするので、旅行者は自分で数え直さずに済む。
  private func notice(_ message: String) -> some View {
    Text(message)
      .tcFont(.body)
      .foregroundStyle(Tokens.Color.warnInk)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(12)
      .background(RoundedRectangle(cornerRadius: Tokens.Radius.control).fill(Tokens.Color.warnBg))
      .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.control).stroke(Tokens.Color.warnBorder, lineWidth: 1))
      .accessibilityAddTraits(.isStaticText)
  }

  /// 未解決のまま置いて行かれようとしている必須・予約の名前。`nil` なら確認は出ない。
  private var blockedNames: [String]? {
    guard case .mustUnresolved(let names) = store.view.pendingHardEdit else { return nil }
    return names
  }

  /// `sheet(item:)` は `Identifiable` を要る。`UUID` そのものは名乗らないので、1 枚包む。
  private struct ManualPinTarget: Identifiable {
    let id: UUID
  }
}

#Preview {
  let store = PlannerStore(resolvers: [], store: nil)
  store.view.screen = .resolve
  return RootView().environment(store)
}
