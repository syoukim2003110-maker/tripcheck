import Foundation

/*
 * Adapts the existing deterministic planner into the explicit evidence model.
 *
 * lib/feasibility-result.ts:225-248 (`statusCounts`, `fact`) and :256-677
 * (`createPlannerEvidenceSnapshot`).
 */

extension Feasibility {
  /// JS truthiness for the `string | undefined` fields TS tests with `Boolean(...)` / `||`:
  /// an empty string is falsy, so `verifiedAt: ""` is *not* evidence of anything.
  static func isTruthy(_ value: String?) -> Bool { !(value ?? "").isEmpty }

  /// TS `new Date().toISOString()` — UTC with milliseconds, e.g. `2026-08-09T00:00:00.000Z`.
  /// Public because the app layer stamps its own records with the same spelling (Plan 2).
  public static func nowISO8601(_ date: Date = Date()) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    return formatter.string(from: date)
  }

  /// TS `statusCounts` (`lib/feasibility-result.ts:225-236`). A user-provided fact counts as
  /// verified *and* is tallied separately; everything that is not verified/user-provided/estimated
  /// — including `failed` — is unknown.
  static func statusCounts(_ facts: [CriticalFact]) -> CriticalFactCounts {
    var counts = CriticalFactCounts(total: facts.count, verified: 0, estimated: 0, unknown: 0, userProvided: 0)
    for fact in facts {
      switch fact.evidence.status {
      case .verified: counts.verified += 1
      case .user_provided:
        counts.userProvided += 1
        counts.verified += 1
      case .estimated: counts.estimated += 1
      case .unknown, .failed: counts.unknown += 1
      }
    }
    return counts
  }

  /// TS `fact` (`lib/feasibility-result.ts:238-248`) — the `Omit<Evidence, "value"|"status"|"source">`
  /// spread becomes four defaulted keyword arguments.
  static func fact(
    _ id: String,
    _ kind: CriticalFactKind,
    _ label: String,
    _ value: JSONValue?,
    _ status: EvidenceStatus,
    _ source: EvidenceSource,
    fetchedAt: String? = nil,
    expiresAt: String? = nil,
    providerRef: String? = nil,
    explanation: String? = nil
  ) -> CriticalFact {
    CriticalFact(
      id: id,
      kind: kind,
      label: label,
      evidence: Evidence(
        value: value,
        status: status,
        source: source,
        fetchedAt: fetchedAt,
        expiresAt: expiresAt,
        providerRef: providerRef,
        explanation: explanation
      )
    )
  }

  /// TS `createPlannerEvidenceSnapshot` (`lib/feasibility-result.ts:256-677`).
  ///
  /// It deliberately counts a stay estimate and an unverified opening window as separate facts: a
  /// resolved pin is not proof that the visit will be open or that the assumed stay is correct.
  public static func snapshot(plan: BuiltTripPlan, options: EvidenceSnapshotOptions) -> PlannerEvidenceSnapshot {
    var facts: [CriticalFact] = []
    let durationOverrides = Set(options.userDurationStopIds ?? [])
    var seenStops = Set<String>()
    let nonConverged = options.transitConvergence?.nonConverged ?? false

    /// TS `:263-291`
    func addStopCoreFacts(_ stop: RouteStop) -> Bool {
      if seenStops.contains(stop.id) { return false }
      seenStops.insert(stop.id)
      let source: EvidenceSource = isTruthy(stop.providerRef) || stop.id.hasPrefix("google-") ? .google : .tripcheck_catalog
      // A Maps search URL authored from free text is only a convenience link,
      // not proof that the traveller meant one exact provider entity.
      let identityIsKnown = !(stop.isUserEntered ?? false) && isTruthy(stop.sourceUrl) && isTruthy(stop.verifiedAt)
      let userProvidedCoordinates = stop.userProvidedCoordinates ?? false
      let identityStatus: EvidenceStatus = userProvidedCoordinates
        ? .user_provided
        : identityIsKnown ? .verified : .unknown
      facts.append(fact(
        "place:\(stop.id)",
        .place_identity,
        stop.name,
        identityStatus == .unknown ? nil : .string(stop.id),
        identityStatus,
        userProvidedCoordinates ? .user : source,
        fetchedAt: isTruthy(stop.verifiedAt) ? stop.verifiedAt : nil,
        providerRef: stop.providerRef ?? (stop.id.hasPrefix("google-") ? String(stop.id.dropFirst(7)) : nil)
      ))
      facts.append(fact(
        "duration:\(stop.id)",
        .stay_duration,
        stop.name,
        .number(Double(stop.planningDurationMinutes)),
        durationOverrides.contains(stop.id) ? .user_provided : .estimated,
        durationOverrides.contains(stop.id) ? .user : .derived
      ))
      return true
    }

    /// TS `:300-302` / `:377-379` — pair-only evidence (no request key, no departure bucket) can
    /// never bind a leg to one provider departure.
    func hasBoundProvenance(_ evidence: RouteFactEvidence?) -> Bool {
      guard let evidence else { return false }
      return evidence.mode == .transit && !evidence.requestKey.isEmpty && !evidence.departureBucket.isEmpty
    }

    /// TS `routeEvidence.minutes === minutes` — `false` when there is no evidence at all, exactly
    /// as `undefined === …` is in TS.
    func minutesMatch(_ evidence: RouteFactEvidence?, _ minutes: Int?) -> Bool {
      guard let evidence else { return false }
      return evidence.minutes == minutes
    }

    /// TS `routeEvidence.transferCount === count`
    func transferCountMatch(_ evidence: RouteFactEvidence?, _ count: Int?) -> Bool {
      guard let evidence else { return false }
      return evidence.transferCount == count
    }

    /// TS `addRouteFact` (`lib/feasibility-result.ts:292-363`)
    func addRouteFact(_ id: String, _ label: String, _ minutes: Int?, _ mode: TransportMode?, _ planSource: ModeSource?) {
      let routeEvidence = options.routeEvidenceByFactId?[id]
      let exactLiveValue = mode == .transit
        && planSource == .live
        && routeEvidence?.status == .verified
        && minutesMatch(routeEvidence, minutes)
        && isTruthy(routeEvidence?.fetchedAt)
        && hasBoundProvenance(routeEvidence)
      let metadataExplanation: String? = {
        guard let routeEvidence else { return nil }
        if nonConverged {
          return "Transit times were measured, but the itinerary did not stabilize within the bounded replan loop. The schedule uses the largest observed duration."
        }
        if routeEvidence.status == .failed || routeEvidence.status == .unknown {
          return "Live transit evidence was \(routeEvidence.status.rawValue); the schedule still uses a planning estimate of \(minutes.map(String.init) ?? "unknown") minutes."
        }
        if routeEvidence.minutes != minutes {
          return "This departure bucket measured \(routeEvidence.minutes.map(String.init) ?? "unknown") minutes; the schedule conservatively consumes \(minutes.map(String.init) ?? "unknown") minutes from the bounded route loop."
        }
        return nil
      }()

      if mode == .transit && routeEvidence?.status != .verified {
        // The schedule value came from a live measurement at the provisional
        // departure (post-build prefetch) even though no convergence-bound
        // evidence exists yet — that is a live-informed estimate, not an
        // untouched unknown.
        let provisionallyMeasured = planSource == .live && routeEvidence == nil
        // An undated itinerary cannot be bound to one provider departure. The
        // solver still consumes a deterministic planning duration, which the UI
        // already labels as an estimate. Counting that same value as an
        // "unconfirmed critical fact" made an impossible to-do out of the
        // traveller's deliberate choice to plan without dates. A real provider
        // failure remains failed; once a date is supplied, missing exact-route
        // evidence remains unknown.
        let undatedEstimate = !options.dateWasProvided && routeEvidence?.status != .failed && minutes != nil
        let hasPlanningEstimate = provisionallyMeasured || undatedEstimate
        let usesMetadata = !provisionallyMeasured && !undatedEstimate
        facts.append(fact(
          id,
          .route_leg,
          label,
          hasPlanningEstimate ? minutes.map { JSONValue.number(Double($0)) } : nil,
          hasPlanningEstimate ? .estimated : routeEvidence?.status.evidenceStatus ?? .unknown,
          provisionallyMeasured || isTruthy(routeEvidence?.providerRef) ? .google : hasPlanningEstimate ? .derived : .other,
          fetchedAt: usesMetadata ? routeEvidence?.fetchedAt : nil,
          providerRef: usesMetadata ? routeEvidence?.providerRef : nil,
          explanation: provisionallyMeasured
            ? "Measured live for a provisional departure; adding the trip date binds it to an exact departure."
            : undatedEstimate
              ? "This is an undated planning estimate; adding the trip date enables an exact departure lookup."
              : metadataExplanation
        ))
        return
      }
      let verified = exactLiveValue && !nonConverged
      facts.append(fact(
        id,
        .route_leg,
        label,
        minutes.map { JSONValue.number(Double($0)) },
        verified ? .verified : .estimated,
        exactLiveValue ? .google : .derived,
        fetchedAt: routeEvidence?.fetchedAt,
        providerRef: routeEvidence?.providerRef,
        explanation: metadataExplanation
      ))
    }

    /// TS `addTransferFact` (`lib/feasibility-result.ts:364-410`)
    func addTransferFact(_ id: String, _ routeFactId: String, _ label: String, _ routeMinutes: Int?, _ count: Int?) {
      // Transfer counts only exist for a concrete departure time. Without a
      // confirmed trip date they are structurally unobtainable, so listing them
      // as unresolved critical facts would be an impossible to-do; the date
      // assumption row already carries the one real action.
      guard options.dateWasProvided else { return }
      let routeEvidence = options.routeEvidenceByFactId?[routeFactId]
      let exactProviderValue = count != nil
        && routeEvidence?.status == .verified
        && minutesMatch(routeEvidence, routeMinutes)
        && transferCountMatch(routeEvidence, count)
        && isTruthy(routeEvidence?.fetchedAt)
        && hasBoundProvenance(routeEvidence)
      let status: EvidenceStatus = routeEvidence?.status == .failed
        ? .failed
        : exactProviderValue
          ? (nonConverged ? .estimated : .verified)
          : .unknown
      facts.append(fact(
        id,
        .mobility_policy,
        label,
        status == .unknown || status == .failed ? nil : count.map { JSONValue.number(Double($0)) },
        status,
        exactProviderValue ? .google : isTruthy(routeEvidence?.providerRef) ? .google : .other,
        fetchedAt: routeEvidence?.fetchedAt,
        providerRef: routeEvidence?.providerRef,
        explanation: exactProviderValue
          ? (nonConverged ? "The observed transfer count is retained, but the transit schedule did not converge." : nil)
          : routeEvidence?.status == .failed
            ? "The transit provider failed, so the transfer limit has not been checked."
            : "Complete transit-step data was not returned for this exact departure bucket."
      ))
    }

    // TS `:412-535` — one pass per planned day.
    for (dayIndex, day) in plan.days.enumerated() {
      for built in day.stops {
        if built.kind != .place || !addStopCoreFacts(built.stop) { continue }
        if !PlaceHours.requiresOpeningHours(built.stop) { continue }
        let hoursKnown = built.openingStatus != .unknown
        let hoursEvidence = options.openingEvidenceByStop?[built.stop.id]
        let isDateSpecific = (hoursEvidence?.dateSpecific ?? false)
          || (day.date.map { date in hoursEvidence?.dateSpecificDates?.contains(date) ?? false } ?? false)
        // Fetched weekly hours that are not yet bound to a confirmed date (or a
        // place with no listed hours at all) are known-but-unbound evidence:
        // "estimated", never the actionable-critical "unknown" reserved for
        // hours nobody has fetched.
        let hoursStatus: EvidenceStatus = hoursEvidence == nil
          ? .unknown
          : !hoursKnown
            ? .estimated
            : isDateSpecific
              ? .verified
              : .estimated
        // TS spreads the whole `hoursEvidence` object into the evidence (`:441`), which carries
        // `dateSpecific`/`dateSpecificDates` along as untyped extras — `Evidence<T>` declares
        // neither. Both are already spent above deciding `hoursStatus`, and nothing downstream
        // reads them off a fact, so only the two declared keys are copied here.
        facts.append(fact(
          "hours:\(built.stop.id):\(day.date ?? day.label)",
          .opening_hours,
          built.stop.name,
          hoursKnown ? .string(built.openingStatus.rawValue) : nil,
          hoursStatus,
          hoursEvidence != nil ? .google : .other,
          fetchedAt: hoursEvidence?.fetchedAt,
          providerRef: hoursEvidence?.providerRef,
          explanation: hoursEvidence != nil && !hoursKnown
            ? "Weekly hours are fetched; confirm the trip date to bind them to exact days."
            : nil
        ))
        if let lastEntryEvidence = options.lastEntryEvidenceByStop?[built.stop.id] {
          facts.append(fact(
            "last-entry:\(built.stop.id):\(day.date ?? day.label)",
            .last_entry,
            "\(built.stop.name) last entry",
            .string(lastEntryEvidence.time),
            lastEntryEvidence.status.evidenceStatus,
            lastEntryEvidence.status == .user_provided ? .user : isTruthy(lastEntryEvidence.providerRef) ? .google : .other,
            fetchedAt: lastEntryEvidence.fetchedAt,
            providerRef: lastEntryEvidence.providerRef
          ))
        }
      }

      for leg in day.legs {
        let routeFactId = "route:\(day.label):\(leg.from.id):\(leg.to.id)"
        addRouteFact(
          routeFactId,
          "\(leg.from.name) → \(leg.to.name)",
          leg.comparison.recommended.minutes,
          leg.comparison.recommended.mode,
          leg.comparison.recommended.source
        )
        if leg.comparison.recommended.mode == .transit {
          addTransferFact(
            "transfers:\(day.label):\(leg.from.id):\(leg.to.id)",
            routeFactId,
            "\(leg.from.name) → \(leg.to.name) transfers",
            leg.comparison.recommended.minutes,
            leg.transferCount
          )
        }
      }

      if let startBase = day.startBase, let first = day.stops.first {
        let routeFactId = "route:\(day.label):\(startBase.id):\(first.stop.id)"
        addRouteFact(
          routeFactId,
          "\(startBase.name) → \(first.stop.name)",
          day.hotelOutboundMinutes,
          day.hotelOutboundMode,
          day.hotelOutboundSource
        )
        if day.hotelOutboundMode == .transit {
          addTransferFact(
            "transfers:\(day.label):\(startBase.id):\(first.stop.id)",
            routeFactId,
            "\(startBase.name) → \(first.stop.name) transfers",
            day.hotelOutboundMinutes,
            day.hotelOutboundTransferCount
          )
        }
      }
      if let endBase = day.endBase, let last = day.stops.last {
        let routeFactId = "route:\(day.label):\(last.stop.id):\(endBase.id)"
        addRouteFact(
          routeFactId,
          "\(last.stop.name) → \(endBase.name)",
          day.hotelInboundMinutes,
          day.hotelInboundMode,
          day.hotelInboundSource
        )
        if day.hotelInboundMode == .transit {
          addTransferFact(
            "transfers:\(day.label):\(last.stop.id):\(endBase.id)",
            routeFactId,
            "\(last.stop.name) → \(endBase.name) transfers",
            day.hotelInboundMinutes,
            day.hotelInboundTransferCount
          )
        }
      }

      let startWasProvided = isTruthy(options.dayStartTimes?[dayIndex])
      let endWasProvided = isTruthy(options.dayEndTimes?[dayIndex]) || options.dayEndWasProvided
      facts.append(fact(
        "day-start:\(day.label)",
        .day_window,
        "\(day.label) start",
        .string(day.requestedStartTime),
        startWasProvided ? .user_provided : .estimated,
        startWasProvided ? .user : .derived
      ))
      facts.append(fact(
        "day-end:\(day.label)",
        .day_window,
        "\(day.label) end",
        day.deadline.map { JSONValue.string($0) },
        endWasProvided ? .user_provided : .estimated,
        endWasProvided ? .user : .derived
      ))
    }

    // TS `:537-558` — places the plan could not seat still owe the traveller their facts.
    for stop in plan.deferredOptionalStops {
      if !addStopCoreFacts(stop) { continue }
      facts.append(fact("hours:\(stop.id):deferred", .opening_hours, stop.name, nil, .unknown, .other))
    }
    for stop in plan.deferredUnavailableStops {
      if !addStopCoreFacts(stop) { continue }
      let hoursEvidence = options.openingEvidenceByStop?[stop.id]
      let plannedDates = plan.days.compactMap(\.date)
      let allDatesSpecific = (hoursEvidence?.dateSpecific ?? false)
        || (!plannedDates.isEmpty && plannedDates.allSatisfy { hoursEvidence?.dateSpecificDates?.contains($0) ?? false })
      // Same `{ ...hoursEvidence }` spread as the scheduled-day fact above (`:556`), and the same
      // two declared keys survive it.
      facts.append(fact(
        "hours:\(stop.id):unavailable",
        .opening_hours,
        stop.name,
        hoursEvidence != nil ? .string("closed_on_all_days") : nil,
        allDatesSpecific ? .verified : hoursEvidence != nil ? .estimated : .unknown,
        hoursEvidence != nil ? .google : .other,
        fetchedAt: hoursEvidence?.fetchedAt,
        providerRef: hoursEvidence?.providerRef
      ))
    }

    for entry in plan.unknownEntries {
      facts.append(fact("place:unresolved:\(entry)", .place_identity, entry, nil, .unknown, .other))
    }

    // TS `:564-584`
    let baseVerified = plan.selectedBase.map { base in
      options.baseWasProvided && !(base.isUserEntered ?? false) && isTruthy(base.sourceUrl) && isTruthy(base.verifiedAt)
    } ?? false
    let baseSource: EvidenceSource = {
      guard let base = plan.selectedBase else { return .derived }
      if isTruthy(base.providerRef) || base.id.hasPrefix("google-") || base.id.hasPrefix("hotel-") { return .google }
      return isTruthy(base.sourceUrl) ? .tripcheck_catalog : .derived
    }()
    facts.append(fact(
      "base",
      .base,
      plan.selectedBase?.name ?? "base",
      plan.selectedBase.map { JSONValue.string($0.id) },
      plan.selectedBase != nil ? (baseVerified ? .verified : .estimated) : .unknown,
      baseSource,
      fetchedAt: plan.selectedBase?.verifiedAt,
      providerRef: plan.selectedBase?.providerRef
    ))

    // TS `:586-615`
    for boundary in plan.airportConstraints {
      facts.append(fact(
        "airport:\(boundary.direction.rawValue):\(boundary.airport)",
        .airport_boundary,
        "\(boundary.direction.rawValue):\(boundary.airport)",
        .string(boundary.cityTime),
        .estimated,
        .derived,
        explanation: "Flight time is user-provided; airport processing and city transfer are planning estimates."
      ))
      let routeFactId = "route:airport:\(boundary.direction.rawValue):\(boundary.airport)"
      guard let routeEvidence = options.routeEvidenceByFactId?[routeFactId] else { continue }
      let label = boundary.direction == .arrival ? "\(boundary.airport) → base" : "base → \(boundary.airport)"
      addRouteFact(routeFactId, label, boundary.transferMinutes, .transit, routeEvidence.status == .verified ? .live : .estimate)
      addTransferFact(
        "transfers:airport:\(boundary.direction.rawValue):\(boundary.airport)",
        routeFactId,
        "\(label) transfers",
        boundary.transferMinutes,
        boundary.transferCount
      )
    }

    // TS `:617-668`
    if !options.dateWasProvided {
      // "No date yet" is a declared planning mode, not a missing provider fact.
      // Keep it visible in assumptions while excluding it from the actionable
      // unknown count. No operating hours or exact departure is invented.
      facts.append(fact(
        "assumption:date",
        .opening_hours,
        "trip date",
        .string("undated"),
        .estimated,
        .derived,
        explanation: "The itinerary is an undated visit-order and duration estimate."
      ))
    }
    if let transferBufferMinutes = options.transferBufferMinutes {
      facts.append(fact(
        "assumption:transfer-buffer",
        .route_leg,
        "transfer buffer",
        .number(Double(transferBufferMinutes)),
        .estimated,
        .derived,
        explanation: "\(transferBufferMinutes) minutes is added after each travelled leg."
      ))
    }
    if let convergence = options.transitConvergence, convergence.nonConverged {
      facts.append(fact(
        "assumption:transit-convergence",
        .route_leg,
        "transit schedule convergence",
        nil,
        .unknown,
        .derived,
        explanation: "The route/schedule loop stopped after \(convergence.iterations) iterations and \(convergence.eventCount) provider events (\(convergence.stopReason))."
      ))
    }
    facts.append(fact(
      "mobility:walking-limit",
      .mobility_policy,
      "maximum walking per leg",
      .number(Double(plan.mobilityPolicy.maxWalkingMinutesPerLeg)),
      plan.mobilityPolicy.walkingLimitWasProvided ? .user_provided : .estimated,
      plan.mobilityPolicy.walkingLimitWasProvided ? .user : .derived
    ))
    facts.append(fact(
      "mobility:transfer-limit",
      .mobility_policy,
      "maximum transfers per leg",
      .number(Double(plan.mobilityPolicy.maxTransfersPerLeg)),
      plan.mobilityPolicy.transferLimitWasProvided ? .user_provided : .estimated,
      plan.mobilityPolicy.transferLimitWasProvided ? .user : .derived
    ))

    return PlannerEvidenceSnapshot(
      facts: facts,
      capturedAt: options.capturedAt ?? nowISO8601(),
      providerSnapshotHash: FNV1a.hashEvidenceFacts(facts),
      solverTimedOut: options.solverTimedOut == true ? true : nil
    )
  }
}
