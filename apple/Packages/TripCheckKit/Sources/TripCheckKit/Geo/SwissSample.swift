import Foundation

/// `Destinations.byId(.switzerland).sampleStops`(lib/destinations.ts:284-293、スイス 8 地点)を
/// `ResolvedStop` の配列にする。
///
/// 各欄は Web のデモ投入(`app/components/planner/hooks/usePlanBuild.tsx:808-822` の
/// `queuedDemoSeedRef.current = demoDestination.sampleStops?.map(...)`)を**そのまま**写したもの:
/// id は `sample-${destinationId}-${index}`、`input`/`name` はロケール名、`area`/`address` は
/// ロケール地区名、`sourceUrl` と `verifiedAt` は空文字、`confidence` は `medium`、
/// `planningDurationMinutes` は `stayMinutes`、`isAnchor` は `false`、`openingHoursApplicable` は
/// **`false` のときだけ立てて、それ以外は欄ごと無い**(TS のスプレッド `...(x === false ? {...} : {})`)。
///
/// Task 7 のブリーフが指定していた `sample-N` / `verifiedAt: "2026-08-09"` / `isAnchor: true` は
/// Web に対応するものが無い値だった(Task 21 のレビューで判明)。同じサンプルが Web とアプリで
/// 別物になると、共有リンク・golden・`Resolution/CatalogResolver` の答えが食い違うため、
/// **Web 側に合わせる**。`provider` だけは TS に無い Swift の由来タグ(spec §4.3)で `.catalog`。
public enum SwissSample {
  public static func resolvedStops(locale: PlannerLocale) -> [ResolvedStop] {
    let destination = Destinations.byId(.switzerland)
    return (destination.sampleStops ?? []).enumerated().map { index, stop in
      let name = stop.names[locale] ?? stop.names[.en] ?? ""
      let area = stop.area[locale] ?? stop.area[.en] ?? ""
      let routeStop = RouteStop(
        id: "sample-\(destination.id.rawValue)-\(index)",
        name: name,
        area: area,
        latitude: stop.latitude,
        longitude: stop.longitude,
        // TS の DestinationSampleStop に sourceUrl は無い(lib/destinations.ts:121-129)。
        sourceUrl: "",
        verifiedAt: "",
        confidence: .medium,
        planningDurationMinutes: stop.stayMinutes,
        isAnchor: false,
        // TS は `openingHoursApplicable === false` のときだけ欄を置く(`usePlanBuild.tsx:822`)。
        // 既定の true は**欄が無い**状態で、`VisitWindows.requiresOpeningHours` はどちらも同じに扱う。
        openingHoursApplicable: stop.openingHoursApplicable ? nil : false
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
