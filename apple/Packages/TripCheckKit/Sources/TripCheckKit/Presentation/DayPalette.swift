import Foundation

/// TS `PLANNER_MAP_DAY_COLORS`(`lib/planner-map-model.ts:4-12`)と
/// `plannerMapDayColor` の色選択(`:107`)。
///
/// 7 色で 1 巡する —— 8 日目は 1 日目と同じ色に戻る。TS は `index % length` を
/// 正規化済みの添字にだけ当てるが、Swift の `%` は負数で負を返すので、負の添字でも
/// 必ず 0..<7 に落ちる形にしてある。
public enum DayPalette {
  public static let colors: [String] = [
    "#2563EB",
    "#7C3AED",
    "#C2410C",
    "#15803D",
    "#BE185D",
    "#0F766E",
    "#A16207",
  ]

  public static func color(forDayIndex index: Int) -> String {
    colors[((index % colors.count) + colors.count) % colors.count]
  }
}
