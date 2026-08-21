// Task 2 は EngineConstants が参照する Pace のみを先取りする。
// 残りの Builder 型(StopPriority, MealPlan, MealKind, TransportMode, TravelPreference, VisitWindow, FlightKind)は Task 9 で追加される。
public enum Pace: String, Codable, Sendable, CaseIterable {
  case relaxed, balanced, fast
}
