/// 統合仕様 §7.2 の表。全タスク共通の定数はここに集約し、他ファイルに数値リテラルで再定義しない。
public enum EngineConstants {
  public static let defaultDayStart = ClockTime(minutes: 9 * 60)
  public static let defaultDayEnd = ClockTime(minutes: 22 * 60)
  public static let paceStopsPerDay: [Pace: Int] = [.relaxed: 3, .balanced: 4, .fast: 5]
  public static let paceDayBudgetMinutes: [Pace: Int] = [.relaxed: 480, .balanced: 570, .fast: 660]
  public static let maxDayAssignmentStops = 12
  public static let maxDayAssignmentEvaluations = 600
  public static let exactOrderingLimit = 7
  public static let heldKarpLimit = 10
  public static let trimLegMinutes = 35
  public static let transferBufferChoices: Set<Int> = [0, 10, 20, 30]
  public static let defaultTransferBuffer = 10
  public static let defaultMaxWalkingMinutesPerLeg = 30   // [5, 180]
  public static let defaultMaxTransfersPerLeg = 2         // [0, 8]
  public static let stayMinutesRange = 15...480
  public static let dayAnchorStayMinutes = 300
  public static let tripDaysRange = 1...14
  public static let maxScenarioDays = 14
  public static let tripFitTimeout: Duration = .seconds(1)
  public static let tightBufferMinutes = 60
  public static let cutCandidateLimit = 6
  public static let counterfactualLimit = 3
  public static let googleMapsWaypointLimit = 10
}
