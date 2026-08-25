import Foundation

/// App Attest から返るエラーのうち、`WorkerClient` が挙動を変えるもの。
public enum AppAttestError: Error, Equatable, Sendable {
  /// 端末の鍵が無効になった(アンインストール後など)。keyId を捨てて登録からやり直す合図。
  case keyInvalid
  case failed
}

/// `DCAppAttestService` を薄く包んだ面。テストはフェイクに差し替える。
public protocol AppAttesting: Sendable {
  var isSupported: Bool { get }
  func generateKey() async throws -> String
  func attest(keyId: String, clientDataHash: Data) async throws -> Data
  func assert(keyId: String, clientDataHash: Data) async throws -> Data
}

#if canImport(DeviceCheck)
import DeviceCheck

/// 実機の App Attest。Simulator では `isSupported` が false になり、`WorkerClient` は
/// バイパス経路(あれば)に落ちる。
public struct DeviceCheckAttestor: AppAttesting {
  public init() {}

  public var isSupported: Bool { DCAppAttestService.shared.isSupported }

  public func generateKey() async throws -> String {
    try await DCAppAttestService.shared.generateKey()
  }

  public func attest(keyId: String, clientDataHash: Data) async throws -> Data {
    do {
      return try await DCAppAttestService.shared.attestKey(keyId, clientDataHash: clientDataHash)
    } catch let error as DCError where error.code == .invalidKey {
      throw AppAttestError.keyInvalid
    }
  }

  public func assert(keyId: String, clientDataHash: Data) async throws -> Data {
    do {
      return try await DCAppAttestService.shared.generateAssertion(keyId, clientDataHash: clientDataHash)
    } catch let error as DCError where error.code == .invalidKey {
      throw AppAttestError.keyInvalid
    }
  }
}
#endif
