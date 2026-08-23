import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 何を渡すかを決めてから配る、共有の 1 枚。
///
/// 4 つのスイッチは**既定では旅行日だけが入**っている(Web `usePlannerViewState.tsx:45` と
/// 同じ既定)—— ホテルの名前も空港の時刻も予約の印も、旅行者が明示的に入れると言うまで
/// リンクに乗らない。選択を変えるたびに、隠した件数・落とした行数・警告が同じ画面の中で
/// 動くので、押す前に何が渡るかが見える。
///
/// この画面はリンクを 1 文字も組み立てない。コードも URL も `PlannerStore` の
/// `sharePreview` / `shareURLs` から来る(その先は Kit の `ShareScope` と `ShareCodec`)——
/// 画面が自分で組み立てると、Web と iPhone で隠れるものが違うリンクが 2 種類できる。
struct ShareSheet: View {
  @Environment(PlannerStore.self) private var store
  @Environment(\.dismiss) private var dismiss

  /// 何を含めるか。**この画面が持つ** —— 共有し終われば消える選択で、旅程そのものでも
  /// 保存するものでもない。
  @State private var scope = ShareScopeOptions(dates: true, hotel: false, airports: false, reservations: false)

  var body: some View {
    let text = Copy.for(store.request.locale)
    let app = AppCopy.for(store.request.locale)
    // 1 度だけ畳む。同じ選択なら 2 度目も同じコードになるが、その 2 度目は要らない仕事で、
    // 文と URL が同じ 1 つの結果から出ることのほうが大事(片方だけ古い、が起きない)。
    let preview = store.sharePreview(scope: scope)
    let urls = store.shareURLs(for: preview)
    let notices = store.shareNotices(preview)

    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 14) {
          Text(app.shareSheetSubtitle)
            .tcFont(.label)
            .foregroundStyle(Tokens.Color.muted)

          // リンクを持っている人は誰でも旅程を見られる —— これは**スイッチの上**に置く。
          // 下に置くと、いちばん低い高さのシートでは何を選ぶかを決め終えるまで目に入らない。
          ForEach(notices.filter { $0.kind == .privacy }) { notice in
            noticeLine(notice)
          }

          includeCard(app: app)

          ForEach(notices.filter { $0.kind != .privacy }) { notice in
            noticeLine(notice)
          }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .background(Tokens.Color.bg)
      .navigationTitle(app.shareSheetTitle)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button(text.close) { dismiss() }
            .tcFont(.body)
            .foregroundStyle(Tokens.Color.ink2)
        }
      }
      .safeAreaInset(edge: .bottom) {
        linkButtons(urls: urls, app: app)
      }
    }
    .accessibilityIdentifier("share.sheet")
  }

  // MARK: - 含める情報

  private func includeCard(app: AppCopy) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(app.shareIncludeHeading)
        .tcFont(.dayHeader)
        .foregroundStyle(Tokens.Color.ink)
        .padding(.top, 12)

      toggleRow(app.shareScopeDates, isOn: $scope.dates, identifier: "share.scope.dates")
      hairline
      toggleRow(app.shareScopeHotel, isOn: $scope.hotel, identifier: "share.scope.hotel")
      hairline
      toggleRow(app.shareScopeAirports, isOn: $scope.airports, identifier: "share.scope.airports")
      hairline
      toggleRow(app.shareScopeReservations, isOn: $scope.reservations, identifier: "share.scope.reservations")
    }
    .padding(.horizontal, 14)
    .padding(.bottom, 6)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(RoundedRectangle(cornerRadius: Tokens.Radius.card).fill(Tokens.Color.panel))
    .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.card).stroke(Tokens.Color.line, lineWidth: 1))
    .accessibilityElement(children: .contain)
    .accessibilityLabel(app.shareIncludeHeading)
  }

  /// スイッチ 1 つぶん。`Binding` は呼ぶ側で組む(`EntryEditSheet` と同じ理由 —— 閉包を
  /// 引数で渡すと `body` の MainActor がそこで途切れる)。
  private func toggleRow(_ title: String, isOn: Binding<Bool>, identifier: String) -> some View {
    Toggle(isOn: isOn) {
      Text(title)
        .tcFont(.body)
        .foregroundStyle(Tokens.Color.ink)
        .fixedSize(horizontal: false, vertical: true)
    }
    .tint(Tokens.Color.accent)
    .frame(minHeight: Tokens.Hit.primary)
    .accessibilityIdentifier(identifier)
  }

  private var hairline: some View {
    Rectangle().fill(Tokens.Color.line).frame(height: 1)
  }

  // MARK: - 報せの 1 行

  /// 3 色。常にある注意(privacy)は静かに、選択で消える注意(caution)は琥珀、リンクが
  /// 作れないという知らせ(error)は赤 —— 消える注意と消えない注意が同じ色だと、
  /// スイッチを戻して警告が 1 つ減ったことが「安全になった」と読める。
  private func noticeLine(_ notice: PlannerStore.ShareNotice) -> some View {
    Text(notice.text)
      .tcFont(.meta)
      .foregroundStyle(Self.ink(notice.kind))
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(10)
      .background(RoundedRectangle(cornerRadius: Tokens.Radius.control).fill(Self.background(notice.kind)))
      .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.control).stroke(Self.border(notice.kind), lineWidth: 1))
      .accessibilityIdentifier("share.notice.\(notice.id)")
  }

  private static func ink(_ kind: PlannerStore.ShareNotice.Kind) -> Color {
    switch kind {
    case .privacy: Tokens.Color.ink2
    case .caution: Tokens.Color.warnInk
    case .error: Tokens.Color.danger
    }
  }

  private static func background(_ kind: PlannerStore.ShareNotice.Kind) -> Color {
    switch kind {
    case .privacy: Tokens.Color.tile
    case .caution: Tokens.Color.warnBg
    case .error: Tokens.Color.accentSoft
    }
  }

  private static func border(_ kind: PlannerStore.ShareNotice.Kind) -> Color {
    switch kind {
    case .privacy: Tokens.Color.line
    case .caution: Tokens.Color.warnBorder
    case .error: Tokens.Color.accent
    }
  }

  // MARK: - 配る

  /// 2 本のリンク。上は誰の端末でも開く Web のリンク、下はこのアプリが入っている端末で
  /// 直に開くリンク。**作れないときは押せないボタンを出したまま**にする —— 消すと、
  /// なぜ配れないのかが画面のどこにも無くなる(理由は上の赤い 1 行が言っている)。
  @ViewBuilder private func linkButtons(urls: (web: URL, app: URL)?, app: AppCopy) -> some View {
    VStack(spacing: 8) {
      if let urls {
        ShareLink(item: urls.web, subject: Text(store.shareSubject)) {
          Text(app.shareCopyLink)
            .tcFont(.stats)
            .frame(maxWidth: .infinity)
            .frame(height: Tokens.Hit.primary)
        }
        .buttonStyle(.primaryAccent)
        .accessibilityIdentifier("share.copy")

        ShareLink(item: urls.app, subject: Text(store.shareSubject)) {
          Text(app.shareAppLink)
            .tcFont(.body)
            .frame(maxWidth: .infinity)
            .frame(height: Tokens.Hit.primary)
        }
        .buttonStyle(.secondaryPill)
        .accessibilityIdentifier("share.appLink")
      } else {
        Button { } label: {
          Text(app.shareCopyLink)
            .tcFont(.stats)
            .frame(maxWidth: .infinity)
            .frame(height: Tokens.Hit.primary)
        }
        .buttonStyle(.primaryAccent)
        .disabled(true)
        .accessibilityIdentifier("share.copy")
      }
    }
    .padding(16)
    .background(.ultraThinMaterial)
  }
}

#Preview {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland)
  return ShareSheet()
    .environment(store)
    .task { await store.build() }
}
