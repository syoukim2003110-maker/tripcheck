// Sources/TripCheckAppCore/Intent/IntentAvailability.swift
import Foundation
import FoundationModels
import TripCheckKit

/// 起動時に一度だけ選ぶ:誰が聞き取り係か。可用性の判定はここ(composition root)に
/// 閉じ込め、ストアは「parser が注入されているか」だけを見る —— ユニットテストをホストの
/// Apple Intelligence 状態から切り離すための構え(計画の裁定2)。モデルが起動後に利用可能に
/// なるケースは次回起動で拾う(v1 許容)。
public enum IntentAvailability {
  public static func makeDefaultParser(uiTesting: Bool) -> (any IntentParser)? {
    if uiTesting { return CannedIntentParser() }
    guard #available(iOS 26.0, macOS 26.0, *) else { return nil }
    guard case .available = SystemLanguageModel.default.availability else { return nil }
    return FoundationModelsIntentParser()
  }
}
