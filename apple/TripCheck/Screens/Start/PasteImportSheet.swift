import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// メモや古い旅程を、まとめて行きたい場所リストへ移すところ。
///
/// 3 段階にしてあるのは、貼ったものが**どう読まれたか**を見てから決められるようにするため:
/// 貼る → 「読み取る」で読み取り結果を見る → 「リストに追加」。日の見出しは日として、
/// 場所名として読めない行は読めない行として、足す前に目に入る。
///
/// 読み取りは `WishlistSerialization`(Kit のパーサ)そのもので、アプリだけが読める書き方は
/// 作らない。実際に足すのは `store.importPasted(_:)` が同じ文字列をもう一度読んで行う ——
/// 画面が持った読み取り結果を書き戻すのではなく、常に貼られた文字列が正。
struct PasteImportSheet: View {
  @Environment(PlannerStore.self) private var store
  @Environment(\.dismiss) private var dismiss

  @State private var raw = ""
  @State private var reading: Reading?
  @FocusState private var isWriting: Bool

  /// 「読み取る」を押した時点の読み取り結果。押すまでは何も出さない —— 打っている途中の
  /// 半端な行を「読み取れない行」と数え上げても、書いている人を急かすだけである。
  private struct Reading {
    var entries: [WishlistEntry]
    var unparsed: [String]
  }

  /// 読み取り結果の 1 行。日の見出しは Web の読み取り結果(`PlacesStep.tsx:157-160`)と
  /// 同じく、その日の場所の上に 1 度だけ出す。
  private enum Row {
    case day(Int)
    case place(String)
  }

  var body: some View {
    let text = Copy.for(store.request.locale)
    let app = AppCopy.for(store.request.locale)

    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 12) {
          editor(placeholder: app.pastePlaceholder, label: text.inputLabel)

          Text(text.parseHint)
            .tcFont(.meta)
            .foregroundStyle(Tokens.Color.muted)

          // 読み取ったら鍵盤を降ろす。降ろさないと、読み取り結果そのものが鍵盤の裏に出る。
          Button(app.pasteRead) {
            isWriting = false
            reading = read()
          }
            .buttonStyle(.secondaryPill)
            .tcFont(.body)
            .disabled(raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityIdentifier("paste.read")

          if let reading {
            preview(reading, text: text, app: app)
          }
        }
        .padding(20)
      }
      .background(Tokens.Color.bg)
      .scrollDismissesKeyboard(.interactively)
      .navigationTitle(app.pasteText)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button(text.close) { dismiss() }
            .tcFont(.body)
            .foregroundStyle(Tokens.Color.ink2)
        }
      }
      .safeAreaInset(edge: .bottom) {
        Button {
          store.importPasted(raw)
          dismiss()
        } label: {
          Text(app.pasteAdd)
            .tcFont(.stats)
            .frame(maxWidth: .infinity)
            .frame(height: Tokens.Hit.primary)
        }
        .buttonStyle(.primaryAccent)
        .disabled(reading?.entries.isEmpty ?? true)
        .padding(16)
        .background(.ultraThinMaterial)
        .accessibilityIdentifier("paste.add")
      }
    }
  }

  // MARK: - 貼る

  private func editor(placeholder: String, label: String) -> some View {
    ZStack(alignment: .topLeading) {
      TextEditor(text: $raw)
        .tcFont(.body)
        .foregroundStyle(Tokens.Color.ink)
        .scrollContentBackground(.hidden)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .frame(minHeight: 180)
        .padding(8)
        .focused($isWriting)
        .accessibilityLabel(label)

      if raw.isEmpty {
        // 例そのものは押せない飾り。読み上げにも出さない(隣の説明文が同じことを言う)。
        Text(placeholder)
          .tcFont(.body)
          .foregroundStyle(Tokens.Color.muted)
          .padding(.horizontal, 13)
          .padding(.vertical, 16)
          .allowsHitTesting(false)
          .accessibilityHidden(true)
      }
    }
    .background(RoundedRectangle(cornerRadius: Tokens.Radius.control).fill(Tokens.Color.panel))
    .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.control).stroke(Tokens.Color.controlBorder, lineWidth: 1))
    // 文字が変われば読み取り結果は捨てる —— 古い読み取りを見ながら別の文字列を足させない。
    .onChange(of: raw) { reading = nil }
  }

  // MARK: - 読み取り結果

  private func read() -> Reading {
    let parsed = WishlistSerialization.entries(fromPasted: raw)
    return Reading(entries: parsed.entries, unparsed: parsed.unparsed)
  }

  @ViewBuilder private func preview(_ reading: Reading, text: PlannerCopy, app: AppCopy) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(text.previewHeading(reading.entries.count))
        .tcFont(.dayHeader)
        .foregroundStyle(Tokens.Color.ink)

      // 12 件を超える分は足さずに報せる。足してから消させない。
      if store.request.entries.count + reading.entries.count > PlannerStore.placeLimit {
        Text(app.pasteLimitToast(count: store.request.entries.count + reading.entries.count))
          .tcFont(.meta)
          .foregroundStyle(Tokens.Color.warnInk)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(10)
          .background(RoundedRectangle(cornerRadius: Tokens.Radius.control).fill(Tokens.Color.warnBg))
          .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.control).stroke(Tokens.Color.warnBorder, lineWidth: 1))
      }

      let rows = Self.rows(reading.entries)
      VStack(alignment: .leading, spacing: 6) {
        ForEach(rows.indices, id: \.self) { index in
          switch rows[index] {
          case .day(let day):
            Text(text.previewDay(day))
              .tcFont(.dayHeader)
              .foregroundStyle(Tokens.Color.ink2)
              .padding(.top, index == 0 ? 0 : 4)
          case .place(let name):
            Text(name)
              .tcFont(.body)
              .foregroundStyle(Tokens.Color.ink)
          }
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)

      if !reading.unparsed.isEmpty {
        Text(text.previewUnparsed)
          .tcFont(.dayHeader)
          .foregroundStyle(Tokens.Color.warnInk)
          .padding(.top, 4)
        ForEach(reading.unparsed, id: \.self) { line in
          Text(line)
            .tcFont(.meta)
            .foregroundStyle(Tokens.Color.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
      }
    }
    .padding(14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(RoundedRectangle(cornerRadius: Tokens.Radius.card).fill(Tokens.Color.panel))
    .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.card).stroke(Tokens.Color.line, lineWidth: 1))
    .accessibilityElement(children: .contain)
    .accessibilityLabel(text.previewHeading(reading.entries.count))
  }

  /// 日の見出しは、その日の最初の場所の前に 1 度だけ。日の付かない場所には見出しを出さない
  /// (`WishlistSerialization.raw` が `Day N` を出す条件と同じ)。
  private static func rows(_ entries: [WishlistEntry]) -> [Row] {
    var rows: [Row] = []
    var currentDay: Int?
    for entry in entries {
      if let day = entry.fixedDay, day != currentDay {
        rows.append(.day(day))
        currentDay = day
      }
      rows.append(.place(entry.text))
    }
    return rows
  }
}

#Preview {
  PasteImportSheet().environment(PlannerStore(resolvers: [], store: nil))
}
