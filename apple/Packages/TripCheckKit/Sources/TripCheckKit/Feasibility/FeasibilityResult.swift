import Foundation

/*
 * The verdict itself: which conflicts a built plan actually has, which assumptions the evidence
 * snapshot is standing on, and the ladder that turns the two into one of five states.
 *
 * lib/feasibility-result.ts:679-907 (`collectConflicts`, `collectAssumptions`,
 * `deriveFeasibilityResult`, `createPlanSnapshot`).
 */

extension Feasibility {
  /// TS `collectConflicts` (`lib/feasibility-result.ts:679-753`) — the *structural* conflicts a
  /// built plan carries. Whether one is allowed to refuse the plan is decided later, in `derive`,
  /// by looking at the evidence behind it.
  static func collectConflicts(_ plan: BuiltTripPlan) -> [Conflict] {
    var conflicts: [Conflict] = []
    for (dayIndex, day) in plan.days.enumerated() {
      if day.deadlineOverrunMinutes > 0 {
        conflicts.append(Conflict(
          code: day.deadlineKind == .airport ? .AIRPORT_CUTOFF : .DAY_END_OVERRUN,
          affectedItems: day.stops.map(\.stop.name),
          dayIndex: dayIndex,
          overrunMinutes: day.deadlineOverrunMinutes,
          evidenceIds: day.deadlineKind == .airport
            ? plan.airportConstraints.filter { $0.direction == .departure }.map { "airport:departure:\($0.airport)" }
            : ["day-end:\(day.label)"]
        ))
      }
      for built in day.stops {
        if built.reservationLateMinutes > 0 {
          let inboundLeg = day.legs.first { $0.to.id == built.stop.id }
          let routeEvidenceId = inboundLeg.map { "route:\(day.label):\($0.from.id):\($0.to.id)" }
            ?? day.startBase.map { "route:\(day.label):\($0.id):\(built.stop.id)" }
          conflicts.append(Conflict(
            code: .FIXED_BOOKING_LATE,
            affectedItems: [built.stop.name],
            dayIndex: dayIndex,
            overrunMinutes: built.reservationLateMinutes,
            evidenceIds: ["place:\(built.stop.id)"] + (routeEvidenceId.map { [$0] } ?? [])
          ))
        }
        if built.openingStatus == .conflict || built.openingStatus == .closed_day || built.openingStatus == .last_entry_conflict {
          conflicts.append(Conflict(
            code: built.openingStatus == .closed_day
              ? .CLOSED_ON_FIXED_DAY
              : built.openingStatus == .last_entry_conflict
                ? .LAST_ENTRY_CONFLICT
                : .OPENING_HOURS_CONFLICT,
            affectedItems: [built.stop.name],
            dayIndex: dayIndex,
            overrunMinutes: nil,
            evidenceIds: [built.openingStatus == .last_entry_conflict
              ? "last-entry:\(built.stop.id):\(day.date ?? day.label)"
              : "hours:\(built.stop.id):\(day.date ?? day.label)"]
          ))
        }
      }
    }

    for stop in plan.deferredUnavailableStops {
      conflicts.append(Conflict(
        code: .PLACE_UNAVAILABLE,
        affectedItems: [stop.name],
        dayIndex: nil,
        overrunMinutes: nil,
        evidenceIds: ["place:\(stop.id)", "hours:\(stop.id):unavailable"]
      ))
    }

    // TS `:747-752` — severity, then the largest overrun, then the earliest day (day-less last),
    // then the affected names. `Array.prototype.sort` is stable, hence `stableSorted`.
    return stableSorted(conflicts) { left, right in
      if left.code.weight != right.code.weight { return right.code.weight < left.code.weight }
      let leftOverrun = left.overrunMinutes ?? 0
      let rightOverrun = right.overrunMinutes ?? 0
      if leftOverrun != rightOverrun { return rightOverrun < leftOverrun }
      let leftDay = left.dayIndex ?? jsMaxSafeInteger
      let rightDay = right.dayIndex ?? jsMaxSafeInteger
      if leftDay != rightDay { return leftDay < rightDay }
      return jsLocaleCompare(left.affectedItems.joined(separator: "|"), right.affectedItems.joined(separator: "|")) < 0
    }
  }

  /// TS `collectAssumptions` (`lib/feasibility-result.ts:755-775`). TS accumulates into a `Map`,
  /// whose iteration order is first-insertion order — reproduced here with an explicit order list,
  /// since Swift's `Dictionary` has none.
  static func collectAssumptions(_ snapshot: PlannerEvidenceSnapshot) -> [Assumption] {
    var order: [AssumptionCode] = []
    var groups: [AssumptionCode: [String]] = [:]
    func add(_ code: AssumptionCode, _ id: String) {
      if groups[code] == nil { order.append(code) }
      groups[code, default: []].append(id)
    }
    for item in snapshot.facts {
      let status = item.evidence.status
      if item.id == "assumption:date" { add(.DATE_PROVISIONAL, item.id) }
      else if item.id == "assumption:transit-convergence" { add(.TRANSIT_NON_CONVERGED, item.id) }
      else if item.id == "base" && status == .unknown { add(.BASE_UNKNOWN, item.id) }
      else if item.id.hasPrefix("day-start:") && status == .estimated { add(.DAY_START_DEFAULT, item.id) }
      else if item.id.hasPrefix("day-end:") && status == .estimated { add(.DAY_END_DEFAULT, item.id) }
      else if item.kind == .stay_duration && status == .estimated { add(.STAY_DURATION_ESTIMATED, item.id) }
      else if item.id == "assumption:transfer-buffer" { add(.TRANSFER_BUFFER, item.id) }
      else if item.id == "mobility:walking-limit" && status == .estimated { add(.WALKING_LIMIT_DEFAULT, item.id) }
      else if item.id == "mobility:transfer-limit" && status == .estimated { add(.TRANSFER_LIMIT_DEFAULT, item.id) }
      else if item.id.hasPrefix("transfers:") && status != .verified { add(.TRANSFER_COUNT_UNKNOWN, item.id) }
      else if item.kind == .route_leg && status == .estimated { add(.ROUTE_ESTIMATED, item.id) }
      else if item.kind == .opening_hours && status != .verified && status != .user_provided { add(.OPENING_HOURS_UNKNOWN, item.id) }
      else if item.kind == .last_entry && status == .estimated { add(.LAST_ENTRY_ESTIMATED, item.id) }
      else if item.kind == .airport_boundary && status == .estimated { add(.AIRPORT_TRANSFER_ESTIMATED, item.id) }
    }
    return order.map { Assumption(code: $0, count: groups[$0]?.count ?? 0, evidenceIds: groups[$0] ?? []) }
  }

  /// One over-limit transfer fact, kept as its own type so the TS `flatMap` + `sort` + `[0]` shape
  /// survives the port (`lib/feasibility-result.ts:827-845`).
  private struct TransferLimitViolation {
    var id: String
    var label: String
    var dayIndex: Int?
    var transferCount: Int
    var exceededBy: Int
  }

  /// One over-limit walking leg (`lib/feasibility-result.ts:821-825`).
  private struct WalkingLimitViolation {
    var dayIndex: Int
    var leg: BuiltPlanLeg
    var exceededBy: Int
  }

  /// TS `deriveFeasibilityResult` (`lib/feasibility-result.ts:777-890`).
  public static func derive(
    plan: BuiltTripPlan,
    fit: TripFitAssessment,
    evidence snapshot: PlannerEvidenceSnapshot,
    alternatives: [AlternativePlan] = []
  ) -> FeasibilityResult {
    let criticalFacts = statusCounts(snapshot.facts)
    let evidenceIds = Set(snapshot.facts.map(\.id))
    // TS `new Map(facts.map(…))`: a repeated id keeps the last fact.
    let factsById = Dictionary(snapshot.facts.map { ($0.id, $0) }, uniquingKeysWith: { _, latest in latest })
    let conflicts = collectConflicts(plan)
      .map { conflict -> Conflict in
        var trimmed = conflict
        trimmed.evidenceIds = conflict.evidenceIds.filter { evidenceIds.contains($0) }
        return trimmed
      }
      // Hours can reject a plan only when they are date-qualified. A typical
      // weekly schedule is useful evidence, but holidays and special hours keep
      // the conclusion provisional rather than turning it into a hard conflict.
      .filter { conflict in
        if conflict.code == .LAST_ENTRY_CONFLICT {
          return conflict.evidenceIds.contains { id in
            let status = factsById[id]?.evidence.status
            return status == .verified || status == .user_provided
          }
        }
        if conflict.code != .OPENING_HOURS_CONFLICT && conflict.code != .CLOSED_ON_FIXED_DAY && conflict.code != .PLACE_UNAVAILABLE {
          return true
        }
        return conflict.evidenceIds.contains { factsById[$0]?.evidence.status == .verified }
      }
    let assumptions = collectAssumptions(snapshot)
    let hasUnresolvedPlace = !plan.unknownEntries.isEmpty
    // Unresolved places stay the operative blocker; the computation cap only
    // names itself when everything the traveller typed did resolve.
    let unknownCause: FeasibilityUnknownCause? = hasUnresolvedPlace
      ? .UNRESOLVED_PLACE
      : snapshot.solverTimedOut == true ? .COMPUTATION_LIMIT : nil
    let state: FeasibilityState
    if unknownCause != nil { state = .UNKNOWN }
    else if !conflicts.isEmpty { state = .INFEASIBLE_HARD_CONFLICT }
    else if criticalFacts.unknown > 0 { state = .FEASIBLE_IF_ASSUMPTIONS }
    else if criticalFacts.estimated > 0 { state = .PROVISIONAL_FEASIBLE }
    else { state = .VERIFIED_FEASIBLE }

    let lowestSlack = stableSorted(fit.days.filter { $0.placeCount > 0 && $0.slackMinutes >= 0 }) { left, right in
      if left.slackMinutes != right.slackMinutes { return left.slackMinutes < right.slackMinutes }
      return left.dayIndex < right.dayIndex
    }.first
    let walkingLimitViolation = stableSorted(
      plan.days.enumerated().flatMap { dayIndex, day in
        day.legs.compactMap { leg -> WalkingLimitViolation? in
          leg.comparison.recommended.mode == .walk && leg.walkingLimitExceededMinutes > 0
            ? WalkingLimitViolation(dayIndex: dayIndex, leg: leg, exceededBy: leg.walkingLimitExceededMinutes)
            : nil
        }
      }
    ) { left, right in
      if left.exceededBy != right.exceededBy { return right.exceededBy < left.exceededBy }
      return left.dayIndex < right.dayIndex
    }.first
    let transferLimit = plan.mobilityPolicy.maxTransfersPerLeg
    let transferLimitViolation = stableSorted(
      snapshot.facts.compactMap { item -> TransferLimitViolation? in
        guard item.id.hasPrefix("transfers:"),
              item.evidence.status == .verified || item.evidence.status == .estimated,
              case .number(let raw)? = item.evidence.value,
              let count = safeInteger(raw),
              count > transferLimit else { return nil }
        let dayIndex = plan.days.firstIndex { item.id.hasPrefix("transfers:\($0.label):") }
        return TransferLimitViolation(
          id: item.id,
          label: item.label,
          dayIndex: dayIndex,
          transferCount: count,
          exceededBy: count - transferLimit
        )
      }
    ) { left, right in
      if left.exceededBy != right.exceededBy { return right.exceededBy < left.exceededBy }
      let leftDay = left.dayIndex ?? jsMaxSafeInteger
      let rightDay = right.dayIndex ?? jsMaxSafeInteger
      if leftDay != rightDay { return leftDay < rightDay }
      return jsLocaleCompare(left.id, right.id) < 0
    }.first

    // TS `:846-870` — one attention at a time, in this order, and none at all while a hard
    // conflict is already speaking.
    let primaryAttention: Attention? = {
      if !conflicts.isEmpty { return nil }
      if snapshot.facts.contains(where: { $0.id == "assumption:transit-convergence" }) {
        return Attention(code: .TRANSIT_NON_CONVERGED, dayIndex: nil, minutes: nil, affectedItems: ["transit schedule"])
      }
      if let walkingLimitViolation {
        return Attention(
          code: .WALKING_LIMIT_EXCEEDED,
          dayIndex: walkingLimitViolation.dayIndex,
          minutes: walkingLimitViolation.exceededBy,
          affectedItems: [walkingLimitViolation.leg.from.name, walkingLimitViolation.leg.to.name]
        )
      }
      if let transferLimitViolation {
        return Attention(
          code: .TRANSFER_LIMIT_EXCEEDED,
          dayIndex: transferLimitViolation.dayIndex,
          minutes: nil,
          affectedItems: [transferLimitViolation.label],
          transferCount: transferLimitViolation.transferCount,
          transferLimit: transferLimit
        )
      }
      if criticalFacts.unknown > 0 {
        return Attention(
          code: .UNVERIFIED_FACTS,
          dayIndex: nil,
          minutes: nil,
          affectedItems: snapshot.facts
            .filter { $0.evidence.status == .unknown || $0.evidence.status == .failed }
            .map(\.label)
        )
      }
      if let lowestSlack, lowestSlack.slackMinutes < EngineConstants.tightBufferMinutes {
        return Attention(
          code: .LOW_BUFFER,
          dayIndex: lowestSlack.dayIndex,
          minutes: lowestSlack.slackMinutes,
          affectedItems: [lowestSlack.label]
        )
      }
      return nil
    }()

    return FeasibilityResult(
      state: state,
      unknownCause: unknownCause,
      minimumDays: fit.minimumDays,
      partialMinimumDays: fit.partialMinimumDays,
      unresolvedPlaceNames: plan.unknownEntries,
      searchedThroughDays: fit.searchedThroughDays,
      minimumDaysAssumptions: fit.minimumDaysAssumptions,
      scheduledDays: plan.days,
      conflicts: conflicts,
      primaryConflict: conflicts.first,
      primaryAttention: primaryAttention,
      alternatives: Array(alternatives.prefix(EngineConstants.counterfactualLimit)),
      criticalFacts: criticalFacts,
      assumptions: assumptions,
      engineVersion: ENGINE_VERSION,
      providerSnapshotHash: snapshot.providerSnapshotHash
    )
  }

  /// TS `typeof value === "number" && Number.isSafeInteger(value)` (`lib/feasibility-result.ts:830-831`).
  private static func safeInteger(_ value: Double) -> Int? {
    guard value.isFinite, value == value.rounded(.towardZero), abs(value) <= Double(jsMaxSafeInteger) else { return nil }
    return Int(exactly: value.rounded())
  }

  /// TS `createPlanSnapshot` (`lib/feasibility-result.ts:892-907`).
  public static func planSnapshot(
    id: String,
    plan: BuiltTripPlan,
    result: FeasibilityResult,
    seed: Int = 0,
    createdAt: String? = nil
  ) -> PlanSnapshot {
    PlanSnapshot(
      id: id,
      plan: plan,
      engineVersion: ENGINE_VERSION,
      providerSnapshotHash: result.providerSnapshotHash,
      createdAt: createdAt ?? nowISO8601(),
      seed: seed,
      result: result
    )
  }
}
