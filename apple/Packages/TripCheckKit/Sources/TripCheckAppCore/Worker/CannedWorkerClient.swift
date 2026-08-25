import Foundation

/// UI テスト用。通信も App Attest もせず、常に「認証済み・疎通 OK」を返す。時刻は読まず
/// 固定の遠い未来を使う(決定的)。
public actor CannedWorkerClient: WorkerAuthenticating {
  // 2100-01-01T00:00:00Z。UI テストは日付そのものは見ないが、状態を決定的にするため固定。
  private let expiry = Date(timeIntervalSince1970: 4_102_444_800)

  public init() {}

  public func describe() async -> WorkerClientDescription {
    WorkerClientDescription(baseURL: "canned://worker", attestSupported: true, state: .authenticated(expiresAt: expiry))
  }

  public func ensureSession() async -> WorkerAuthState {
    .authenticated(expiresAt: expiry)
  }

  public func ping() async -> WorkerPingResult {
    WorkerPingResult(ok: true, expiresAt: expiry)
  }

  public func resolvePlaces(_ payload: PlaceResolutionRequestPayload) async -> PlaceResolutionResult? { nil }
}
