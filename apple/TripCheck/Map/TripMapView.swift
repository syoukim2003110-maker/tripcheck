import MapKit
import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 旅程の地図。日ごとの色のピンと、停留所を結ぶ線と、凡例。
///
/// **線は全部破線である。** 区間の形(プロバイダの経路)を持たない鍵ゼロのアプリでは、
/// 実線は書けない —— 実線は「ここを通る」と言い切る絵で、TripCheck はまだ通り道を知らない
/// (統合仕様 §9「欠損ジオメトリは描かない」、spec §5.4)。破線と実線の書き分けを
/// `MapRoute.measured` に預けてあるので、経路が入る次の spec ではこのビューは変わらない。
///
/// 地図の上には TripCheck のものしか出さない(`pointsOfInterest: .excludingAll`)——
/// 端末の地図が持つ店や駅の点が混ざると、どれが自分の旅程なのか読めなくなる。
struct TripMapView: View {
  @Environment(PlannerStore.self) private var store
  @State private var camera: MapCameraPosition = .automatic

  /// 破線の刻み。凡例の見本(`MapLegend`)と**同じ値**を使う。
  static let dash: [CGFloat] = [2, 12]

  /// 画面下の「旅程 | 地図」の帯の高さ(`PlanScreen` の `safeAreaInset`:錠剤 44pt +
  /// 下の余白 8pt)。その `safeAreaInset` は `NavigationStack` の外側に付いているので、
  /// 中の地図の安全域には現れない —— 高さを知っているのはここだけになる。
  private static let viewSwitchBarHeight: CGFloat = Tokens.Hit.primary + 8

  var body: some View {
    @Bindable var store = store
    let model = store.mapModel(scope: store.view.mapScope)

    // 凡例は地図の**安全域**として渡す(重ねるのではなく)。こうすると MapKit が寄せる先を
    // 札の上へ収めてくれる —— ただ重ねると、南端のピンが札の裏に隠れたまま「全部映した」
    // 顔になる。`proxy` はホームバーのぶんを教える。
    GeometryReader { proxy in
      Map(position: $camera) {
        ForEach(model.routes) { route in
          MapPolyline(coordinates: route.points.map(\.clLocation))
            .stroke(
              Tokens.Day.color(index: route.dayIndex).opacity(route.selected ? 0.95 : 0.28),
              style: StrokeStyle(
                lineWidth: route.selected ? 5 : 2,
                lineCap: .round,
                // 計測済みの経路だけが実線になれる。今日はこの枝を通らない。
                dash: route.measured ? [] : Self.dash
              )
            )
        }
        ForEach(model.pins) { pin in
          Annotation(pin.label, coordinate: pin.coordinate.clLocation, anchor: .bottom) {
            PinView(pin: pin, highlighted: store.view.mapFocusedStopId == pin.id)
              .onTapGesture {
                store.focusStop(id: pin.id)
                // 開く先は**種別ではなく `stopId` が決める**(`MapPin.stopId`)。注意のピンも
                // 自分で置いた点も停留所なので開く —— とりわけ注意のピンは、詳細シートが
                // まさに直しに行く先である。ホテルと食事の枠だけが鍵を持たない。
                if let stopId = pin.stopId { store.openInspector(.stop(stopId)) }
              }
          }
          .annotationTitles(.hidden)
        }
      }
      .mapStyle(.standard(pointsOfInterest: .excludingAll, showsTraffic: false))
      .mapControls { MapScaleView(); MapCompass() }
      .safeAreaInset(edge: .bottom, alignment: .leading, spacing: 0) {
        MapLegend(days: model.legendDays, scope: $store.view.mapScope)
          .padding(12)
          // 札は自分で身をかわす —— ホームバー(`proxy` が教える安全域)と、その上に
          // `PlanScreen` が置いている「旅程 | 地図」の帯のぶん。地図の安全域はどちらも
          // 知らないので(上の定数の注記)、置いただけでは錠剤が帯の裏に沈む。
          .padding(.bottom, proxy.safeAreaInsets.bottom + Self.viewSwitchBarHeight)
      }
      // 日を変えても範囲を変えても、見えている中身に合わせて寄り直す。値は掴んだ `model`
      // ではなく**その時の store** から取る —— 変わった後の日で外接を作らないと、1 手ぶん
      // 前の日に寄ってしまう。
      .onChange(of: store.view.selectedDay) { _, _ in fitCamera() }
      .onChange(of: store.view.mapScope) { _, _ in fitCamera() }
      .onAppear { camera = .region(model.region.mkRegion) }
      .accessibilityElement(children: .contain)
      .accessibilityLabel(Copy.for(store.request.locale).selectHint)
      .accessibilityIdentifier("map")
    }
  }

  @MainActor
  private func fitCamera() {
    camera = .region(store.mapModel(scope: store.view.mapScope).region.mkRegion)
  }
}

#Preview {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland)
  return TripMapView()
    .environment(store)
    .task { await store.build() }
}
