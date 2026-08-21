import Foundation

/// `Destinations.byId(.switzerland).sampleStops`(lib/destinations.ts:284-293、スイス 8 地点)を
/// Builder 向けの `ResolvedStop` 配列に変換するテスト用フィクスチャ。id/provider/confidence/
/// verifiedAt はこのタスクの仕様が指定する固定値であり、TS の `usePlanBuild.tsx` デモシード
/// (`sample-${destinationId}-${index}` / `verifiedAt: ""` / `isAnchor: false`)とは異なる別物 ——
/// あちらは UI 層のデモ投入ロジックで Plan 2 の範囲、こちらは後続タスクのテストが使う固定サンプル。
public enum SwissSample {
  public static func resolvedStops(locale: PlannerLocale) -> [ResolvedStop] {
    let stops = Destinations.byId(.switzerland).sampleStops ?? []
    return stops.enumerated().map { index, stop in
      let name = stop.names[locale] ?? stop.names[.en] ?? ""
      let area = stop.area[locale] ?? stop.area[.en] ?? ""
      let routeStop = RouteStop(
        id: "sample-\(index)",
        name: name,
        area: area,
        latitude: stop.latitude,
        longitude: stop.longitude,
        // TS の DestinationSampleStop に sourceUrl は無い(lib/destinations.ts:121-129)。
        sourceUrl: "",
        verifiedAt: "2026-08-09",
        confidence: .medium,
        planningDurationMinutes: stop.stayMinutes,
        isAnchor: true,
        openingHoursApplicable: stop.openingHoursApplicable
      )
      return ResolvedStop(
        routeStop: routeStop,
        input: name,
        inputIndex: index,
        address: area,
        provider: .catalog
      )
    }
  }
}
