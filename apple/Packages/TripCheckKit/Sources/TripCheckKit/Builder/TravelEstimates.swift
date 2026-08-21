import Foundation

/*
 * Straight-line km → door-to-door minutes, plus live provider evidence and the
 * per-leg mode filtering/override the trip builder layers on top.
 *
 * lib/time-feasibility.ts (whole file, 145 lines).
 */

/// TS `ModeEstimate.source` (`lib/time-feasibility.ts:11`)
public enum ModeSource: String, Codable, Sendable, CaseIterable {
  case estimate, live
}

/// TS `ModeEstimate` (`lib/time-feasibility.ts:8-14`)
public struct ModeEstimate: Hashable, Codable, Sendable {
  public var mode: TransportMode
  public var minutes: Int
  public var source: ModeSource?
  /// The provider answered "no such route" for this mode; the minutes are a fiction.
  public var unroutable: Bool?

  public init(mode: TransportMode, minutes: Int, source: ModeSource? = nil, unroutable: Bool? = nil) {
    self.mode = mode
    self.minutes = minutes
    self.source = source
    self.unroutable = unroutable
  }
}

/// TS `ModeComparison` (`lib/time-feasibility.ts:15-19`)
public struct ModeComparison: Hashable, Codable, Sendable {
  public var options: [ModeEstimate]
  public var fastest: ModeEstimate
  public var recommended: ModeEstimate

  public init(options: [ModeEstimate], fastest: ModeEstimate, recommended: ModeEstimate) {
    self.options = options
    self.fastest = fastest
    self.recommended = recommended
  }
}

/// Swift のみの型(TS には対応する 1 つの型がない)。1 レグ分のライブ計測値をまとめたバンドルで、
/// `TravelEstimates.estimate(live:)` へ渡す。`transitMinutes`/`transitAbsent`/`walkingMinutes`/
/// `drivingMinutes` は TS `applyLiveTransitMinutes` の該当パラメータ(`lib/time-feasibility.ts:120-145`)
/// にそのまま渡る。`transferCount` は本ファイルではまだ使われない(将来 `maxTransfersPerLeg` を
/// 見る呼び出し側 — `lib/trip-builder.ts:1156-1195` の `knownTransferCount`/`routeComparison` 相当 —
/// が Task 11 以降で読む想定のプレースホルダ)。
public struct LiveLegEvidence: Hashable, Sendable {
  public var transitMinutes: Int?
  public var transitAbsent: Bool
  public var transferCount: Int?
  public var walkingMinutes: Int?
  public var drivingMinutes: Int?

  public init(
    transitMinutes: Int? = nil,
    transitAbsent: Bool = false,
    transferCount: Int? = nil,
    walkingMinutes: Int? = nil,
    drivingMinutes: Int? = nil
  ) {
    self.transitMinutes = transitMinutes
    self.transitAbsent = transitAbsent
    self.transferCount = transferCount
    self.walkingMinutes = walkingMinutes
    self.drivingMinutes = drivingMinutes
  }

  public static let none = LiveLegEvidence()
}

public enum TravelEstimates {
  private static func roundUpFive(_ value: Double) -> Int {
    Int((value / 5).rounded(.up)) * 5
  }

  /*
   * Straight-line km → door-to-door minutes, tiered so long legs use the fast
   * networks that actually exist (rapid/limited-express rail, expressways)
   * instead of extrapolating a city crawl. Each tier's slope is min/km for the
   * kilometres that fall inside it. lib/time-feasibility.ts:31-41
   */
  private static func tieredMinutes(_ distanceKm: Double, overhead: Double, tiers: [(limitKm: Double, minutesPerKm: Double)]) -> Double {
    var minutes = overhead
    var covered = 0.0
    for tier in tiers {
      let span = min(distanceKm, tier.limitKm) - covered
      if span <= 0 { break }
      minutes += span * tier.minutesPerKm
      covered = tier.limitKm
    }
    return minutes
  }

  // lib/time-feasibility.ts:43-48
  private static func transitEstimate(_ distanceKm: Double) -> Int {
    // 12 min access/wait; ~11 km/h short hop, ~26 km/h urban rail, ~48 km/h
    // regional, ~83 km/h limited express, ~170 km/h shinkansen-class beyond.
    let minutes = tieredMinutes(distanceKm, overhead: 12, tiers: [(3, 5.5), (15, 2.3), (60, 1.25), (150, 0.72), (.infinity, 0.35)])
    return max(10, roundUpFive(minutes))
  }

  // lib/time-feasibility.ts:50-55
  private static func driveEstimate(_ distanceKm: Double) -> Int {
    // 8 min pickup/parking; ~20 km/h city, ~30 km/h arterial, ~50 km/h open
    // road, ~75 km/h expressway.
    let minutes = tieredMinutes(distanceKm, overhead: 8, tiers: [(5, 3), (15, 2), (60, 1.2), (.infinity, 0.8)])
    return max(8, roundUpFive(minutes))
  }

  /*
   * The default recommendation is the shortest sane door-to-door option: walk
   * when it is genuinely short (or outright fastest), otherwise transit or a car
   * depending on which one the destination actually rewards. lib/time-feasibility.ts:66-94
   */
  private static func pickRecommended(_ options: [ModeEstimate], preference: TravelPreference, mobility: MobilityProfile) -> ModeEstimate {
    guard let walk = options.first(where: { $0.mode == .walk }),
          let transit = options.first(where: { $0.mode == .transit }),
          let taxi = options.first(where: { $0.mode == .taxi }) else {
      // Filtered comparisons (allowedModes) may not carry all three modes; fall
      // back to the fastest of whatever remains.
      return options.min { $0.minutes < $1.minutes }!
    }
    if preference == .car { return walk.minutes <= min(10, taxi.minutes) ? walk : taxi }
    if walk.minutes <= 25 || (walk.minutes <= transit.minutes && walk.minutes <= taxi.minutes) { return walk }
    // How many minutes slower transit may be and still be the better answer.
    let transitAllowance: Int
    switch mobility {
    case .transit_first: transitAllowance = max(10, Int((Double(taxi.minutes) * 0.25).rounded(.toNearestOrAwayFromZero)))
    case .balanced: transitAllowance = max(5, Int((Double(taxi.minutes) * 0.1).rounded(.toNearestOrAwayFromZero)))
    case .car_first: transitAllowance = -15
    }
    if transit.unroutable != true && transit.minutes <= taxi.minutes + transitAllowance { return transit }
    // Asymmetric evidence guards on transit-first ground, both directions: a
    // live-measured taxi must not demote a transit option that is still an
    // unmeasured estimate, and a MEASURED train must not lose to an optimistic
    // unmeasured drive estimate. Whenever the two sides carry unequal evidence,
    // the measured transit answer wins; once both are measured the numeric
    // comparison above decides.
    if mobility == .transit_first && transit.unroutable != true && taxi.source == .live && transit.source != .live { return transit }
    if mobility == .transit_first && transit.unroutable != true && transit.source == .live && taxi.source != .live { return transit }
    return taxi
  }

  private static func finalize(_ options: [ModeEstimate], preference: TravelPreference, mobility: MobilityProfile) -> ModeComparison {
    let fastest = options.min { $0.minutes < $1.minutes }!
    return ModeComparison(options: options, fastest: fastest, recommended: pickRecommended(options, preference: preference, mobility: mobility))
  }

  // lib/time-feasibility.ts:105-118, taking a precomputed straight-line distance
  // instead of two `RouteStop`s (callers resolve `straightLineDistanceKm` themselves).
  private static func baseOptions(distanceKm: Double) -> [ModeEstimate] {
    [
      ModeEstimate(mode: .walk, minutes: max(5, roundUpFive(5 + distanceKm / 4.5 * 60))),
      ModeEstimate(mode: .transit, minutes: transitEstimate(distanceKm)),
      ModeEstimate(mode: .taxi, minutes: driveEstimate(distanceKm)),
    ]
  }

  /// TS `applyLiveTransitMinutes` (`lib/time-feasibility.ts:120-145`).
  public static func applyLiveTransit(
    _ comparison: ModeComparison,
    minutes: Int?,
    walkingMinutes: Int? = nil,
    drivingMinutes: Int? = nil,
    preference: TravelPreference = .auto,
    mobility: MobilityProfile = .transit_first,
    transitUnroutable: Bool = false
  ) -> ModeComparison {
    let hasTransit = (minutes ?? 0) > 0
    let hasWalking = (walkingMinutes ?? 0) > 0
    let hasDriving = (drivingMinutes ?? 0) > 0
    if !hasTransit && !hasWalking && !hasDriving && !transitUnroutable {
      return finalize(comparison.options, preference: preference, mobility: mobility)
    }
    let options = comparison.options.map { option -> ModeEstimate in
      if option.mode == .transit && hasTransit {
        var updated = option
        updated.minutes = minutes!
        updated.source = .live
        return updated
      }
      if option.mode == .walk && hasWalking {
        var updated = option
        updated.minutes = walkingMinutes!
        updated.source = .live
        return updated
      }
      if option.mode == .taxi && hasDriving {
        var updated = option
        updated.minutes = drivingMinutes!
        updated.source = .live
        return updated
      }
      var base = option
      base.source = option.source ?? .estimate
      // A provider-answered "no transit route" is negative live evidence: the
      // estimate stays visible for context but may not win the recommendation.
      if option.mode == .transit && transitUnroutable { base.unroutable = true }
      return base
    }
    return finalize(options, preference: preference, mobility: mobility)
  }

  /// Swift-only combinator: `estimateTravelOptions` (`lib/time-feasibility.ts:105-118`) +
  /// `applyLiveTransitMinutes` (`:120-145`) from a precomputed distance, plus the
  /// `allowedTransportModesForLeg` filter and per-leg override applied in
  /// `lib/trip-builder.ts:1131-1195` (`routeComparison`) — minus that function's
  /// `maxWalkingMinutesPerLeg`/`maxTransfersPerLeg` fallback, which is out of this task's scope.
  public static func estimate(
    distanceKm: Double,
    preference: TravelPreference = .auto,
    mobility: MobilityProfile = .transit_first,
    live: LiveLegEvidence = .none,
    allowedModes: [TransportMode]? = nil,
    override: TransportMode? = nil
  ) -> ModeComparison {
    let base = finalize(baseOptions(distanceKm: distanceKm), preference: preference, mobility: mobility)
    let applied = applyLiveTransit(
      base,
      minutes: live.transitMinutes,
      walkingMinutes: live.walkingMinutes,
      drivingMinutes: live.drivingMinutes,
      preference: preference,
      mobility: mobility,
      transitUnroutable: live.transitAbsent
    )
    let restricted: ModeComparison
    if let allowedModes {
      let allowedOptions = applied.options.filter { allowedModes.contains($0.mode) }
      // Curated access policies fail closed: if a malformed future policy
      // removed every supported mode, keep the unfiltered comparison instead
      // of returning something unusable.
      if !allowedOptions.isEmpty && allowedOptions.count != applied.options.count {
        let fastest = allowedOptions.min { $0.minutes < $1.minutes }!
        restricted = ModeComparison(options: allowedOptions, fastest: fastest, recommended: fastest)
      } else {
        restricted = applied
      }
    } else {
      restricted = applied
    }
    // A per-leg pick beats every automatic rule.
    guard let override, let overridden = restricted.options.first(where: { $0.mode == override }) else { return restricted }
    return ModeComparison(options: restricted.options, fastest: restricted.fastest, recommended: overridden)
  }
}
