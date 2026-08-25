import Foundation

/// どの天気プロバイダを使うかは composition root からのこの 1 か所だけで決める(IntentAvailability と同型)。
public enum WeatherAvailability {
  public static func makeDefaultProvider(uiTesting: Bool) -> (any WeatherProviding)? {
    if uiTesting { return CannedWeatherProvider() }
    #if canImport(WeatherKit)
    if #available(iOS 16.0, macOS 13.0, *) { return AppleWeatherProvider() }
    #endif
    return nil
  }
}
