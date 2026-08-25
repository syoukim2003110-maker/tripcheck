import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 1 日の天気チップ(アイコン + 最高/最低℃ + 降水%)。表示専用。
struct WeatherChip: View {
  let day: WeatherDay
  let copy: AppCopy

  var body: some View {
    HStack(spacing: 4) {
      IconView(Self.icon(for: day.kind), size: 12, color: Tokens.Color.ink2)
      Text("\(day.temperatureMaxC)° / \(day.temperatureMinC)°")
        .tcFont(.label)
        .foregroundStyle(Tokens.Color.ink2)
      if let percent = day.precipitationPercent {
        Text(copy.weatherPrecipitation(percent))
          .tcFont(.label)
          .foregroundStyle(Tokens.Color.muted)
      }
    }
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("plan.weatherChip.\(day.index)")
  }

  static func icon(for kind: WeatherKind) -> Icon {
    switch kind {
    case .clear, .partly: return .sun
    case .cloudy: return .cloud
    case .fog: return .fog
    case .rain: return .rain
    case .snow: return .snow
    case .storm: return .storm
    }
  }
}

/// Apple 必須の帰属。テキスト商標 + 法的リンク(Link)。
struct WeatherAttributionBadge: View {
  let attribution: WeatherAttribution
  let copy: AppCopy

  var body: some View {
    Link(destination: attribution.legalPageURL) {
      HStack(spacing: 3) {
        Text(copy.weatherBrand)
          .tcFont(.label)
          .foregroundStyle(Tokens.Color.muted)
        IconView(.external, size: 10, color: Tokens.Color.muted)
      }
    }
    .accessibilityIdentifier("plan.weatherAttribution")
    .accessibilityLabel(copy.weatherAttributionLabel)
  }
}
