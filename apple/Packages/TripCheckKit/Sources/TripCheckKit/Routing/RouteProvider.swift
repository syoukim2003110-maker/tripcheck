// Sources/TripCheckKit/Routing/RouteProvider.swift
import Foundation

/// 1 レグ × 1 手段の問い合わせ。そのままキャッシュの鍵になる —— 座標が等値比較に入るので、
/// 手動ピンを動かせば別の鍵になる。Kit は提供元を知らない(`PlaceResolver` と同じ約束)。
public struct RouteRequest: Hashable, Sendable, Codable {
  /// `routeLegKey(from.id, to.id)` = `"<from>::<to>"`(`Builder/Legs.swift:12`)。
  public let legKey: String
  public let from: GeoPoint
  public let to: GeoPoint
  public let mode: TransportMode
  /// `.transit` は必須、`.taxi` は任意、`.walk` は `nil`(バケット無し)。
  public let departure: Date?

  public init(legKey: String, from: GeoPoint, to: GeoPoint, mode: TransportMode, departure: Date?) {
    self.legKey = legKey; self.from = from; self.to = to; self.mode = mode; self.departure = departure
  }
}

public enum RouteOutcome: Hashable, Sendable {
  case measured(minutes: Int, distanceMeters: Int?, geometry: [GeoPoint]?, expectedDeparture: Date?)
  /// 提供元が「経路なし」と答えた。v1 ではエンジンに入れない(spec §9-24)。
  case unroutable
  /// 通信・スロットル・タイムアウト。何も変えない。
  case failed
}

public protocol RouteProvider: Sendable {
  func route(_ request: RouteRequest, locale: PlannerLocale) async -> RouteOutcome
}

public enum LiveRouteMerge {
  /// 回答を `PlannerContext` の live* に折り込む。`minutes >= 1` のものだけ採用(0 は「根拠なし」)。
  /// `.unroutable` / `.failed` は無視。`liveTransitAbsentLegs` と `liveTransitTransferCounts` には
  /// 何も書かない。鍵・手段・出発時刻で並べてから折り込むので、辞書の列挙順に依らない。
  public static func apply(_ answers: [RouteRequest: RouteOutcome], to context: inout PlannerContext) {
    let ordered = answers.sorted { lhs, rhs in
      if lhs.key.legKey != rhs.key.legKey { return lhs.key.legKey < rhs.key.legKey }
      if lhs.key.mode != rhs.key.mode { return lhs.key.mode.rawValue < rhs.key.mode.rawValue }
      return (lhs.key.departure?.timeIntervalSince1970 ?? -1) < (rhs.key.departure?.timeIntervalSince1970 ?? -1)
    }
    for (request, outcome) in ordered {
      guard case .measured(let minutes, _, _, _) = outcome, minutes >= 1 else { continue }
      switch request.mode {
      case .walk: var d = context.liveWalkingMinutes ?? [:]; d[request.legKey] = minutes; context.liveWalkingMinutes = d
      case .taxi: var d = context.liveDrivingMinutes ?? [:]; d[request.legKey] = minutes; context.liveDrivingMinutes = d
      case .transit: var d = context.liveTransitMinutes ?? [:]; d[request.legKey] = minutes; context.liveTransitMinutes = d
      }
    }
  }
}
