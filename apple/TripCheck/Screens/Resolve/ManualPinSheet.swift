import MapKit
import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 端末の地図が答えられなかった 1 件を、旅行者自身が置く。
///
/// 置いた点は**旅行者の点として運ぶ** —— `userProvidedCoordinates` が真で、証拠の欄
/// (出どころ・確認時刻)は空のまま(統合仕様 §4.2)。提供元が確かめた場所として描かれると、
/// 旅行者が自分で置いた点に「確認済み」の顔が付いてしまう。
///
/// 座標を決める道は 2 つあり、**どちらも同じ 2 つの数に落ちる**:地図を触ると数が入り、
/// 数を打つと地図が動く。地図が使えない場所(機内・電波の無い所)でも、緯度経度さえ分かれば
/// 進める。
struct ManualPinSheet: View {
  let entryID: UUID

  @Environment(PlannerStore.self) private var store
  @Environment(\.dismiss) private var dismiss

  @State private var address = ""
  @State private var latitude = ""
  @State private var longitude = ""
  @State private var camera: MapCameraPosition = .automatic

  /// 地図の高さ。シートの中で「住所・地図・数・ボタン」が同時に見えるだけの大きさに留める。
  private static let mapHeight: CGFloat = 220

  var body: some View {
    let text = Copy.for(store.request.locale)
    let app = AppCopy.for(store.request.locale)

    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          field(app.manualAddressLabel, text: $address, keyboard: .default)

          MapReader { proxy in
            Map(position: $camera)
              .overlay {
                if let point = coordinate.flatMap({ proxy.convert($0, to: .local) }) {
                  IconView(.pin, size: 28, color: Tokens.Color.accent)
                    .position(point)
                    .allowsHitTesting(false)
                }
              }
              .onTapGesture { location in
                guard let tapped = proxy.convert(location, from: .local) else { return }
                latitude = Self.decimal(tapped.latitude)
                longitude = Self.decimal(tapped.longitude)
              }
          }
          .frame(height: Self.mapHeight)
          .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.card))
          .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.card).stroke(Tokens.Color.line, lineWidth: 1))
          .accessibilityLabel(app.manualPinMapLabel)

          HStack(spacing: 10) {
            field(app.manualLatitude, text: $latitude, keyboard: .numbersAndPunctuation)
            field(app.manualLongitude, text: $longitude, keyboard: .numbersAndPunctuation)
          }

          Text(app.manualPinHint)
            .tcFont(.meta)
            .foregroundStyle(Tokens.Color.muted)

          Button {
            guard let point = coordinate else { return }
            store.setManualPin(
              entryId: entryID,
              name: store.request.entries.first { $0.id == entryID }?.text ?? "",
              address: address,
              latitude: point.latitude,
              longitude: point.longitude
            )
            dismiss()
          } label: {
            Text(app.manualUsePoint)
              .tcFont(.stats)
              .frame(maxWidth: .infinity)
          }
          .buttonStyle(.primaryAccent)
          .disabled(coordinate == nil)
          .accessibilityIdentifier("resolve.useThisPoint")
        }
        .padding(20)
      }
      .background(Tokens.Color.bg)
      .navigationTitle(app.resolvePinOnMap)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button(text.close) { dismiss() }
            .tcFont(.body)
            .foregroundStyle(Tokens.Color.accentDeep)
        }
      }
    }
    .presentationDetents([.large])
    // 行き先の国が決まっていれば、そこから見せる —— 世界地図から自国を探させない。
    .task { camera = Self.initialCamera(store.destinationBounds) }
  }

  // MARK: - 2 つの数

  /// 打たれた 2 つの数が地球上の点になっているか。なっていなければ「この地点を使う」は押せない。
  private var coordinate: CLLocationCoordinate2D? {
    guard let lat = Double(latitude), let lon = Double(longitude),
          lat.isFinite, lon.isFinite, (-90...90).contains(lat), (-180...180).contains(lon)
    else { return nil }
    return CLLocationCoordinate2D(latitude: lat, longitude: lon)
  }

  /// 地図から取った座標は 6 桁で丸める —— 10cm の精度で、これ以上の桁は打ち直せない。
  private static func decimal(_ value: Double) -> String {
    String(format: "%.6f", value)
  }

  private static func initialCamera(_ bounds: GeoBounds?) -> MapCameraPosition {
    guard let bounds else { return .automatic }
    return .region(MKCoordinateRegion(
      center: CLLocationCoordinate2D(
        latitude: (bounds.south + bounds.north) / 2,
        longitude: (bounds.west + bounds.east) / 2
      ),
      span: MKCoordinateSpan(
        latitudeDelta: max(bounds.north - bounds.south, 0.01),
        longitudeDelta: max(bounds.east - bounds.west, 0.01)
      )
    ))
  }

  // MARK: - 欄

  private func field(_ label: String, text: Binding<String>, keyboard: UIKeyboardType) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(label)
        .tcFont(.dayHeader)
        .foregroundStyle(Tokens.Color.ink)
      TextField(label, text: text)
        .keyboardType(keyboard)
        .autocorrectionDisabled()
        .tcFont(.body)
        .foregroundStyle(Tokens.Color.ink)
        .padding(.horizontal, 12)
        .frame(minHeight: Tokens.Hit.primary)
        .background(RoundedRectangle(cornerRadius: Tokens.Radius.control).fill(Tokens.Color.panel))
        .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.control).stroke(Tokens.Color.controlBorder, lineWidth: 1))
        .accessibilityLabel(label)
    }
  }
}
