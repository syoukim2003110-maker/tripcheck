import Foundation

/// 認証が失敗した理由。診断画面はコードをそのまま出す(開発用画面なので翻訳しない)。
public enum WorkerAuthFailure: Equatable, Sendable {
  /// この端末が App Attest に対応しておらず、バイパスも無い。
  case attestUnsupported
  /// 通信できなかった。
  case network
  /// サーバがエラーコードを返した(`app_id_mismatch` など、そのまま保持)。
  case server(code: String)
}

/// アプリ ↔ Worker の認証状態。旅程には一切触れない。
public enum WorkerAuthState: Equatable, Sendable {
  case idle
  case authenticating
  case authenticated(expiresAt: Date)
  case failed(WorkerAuthFailure)
}

/// `GET /api/app/ping` の結果。
public struct WorkerPingResult: Equatable, Sendable {
  public let ok: Bool
  public let expiresAt: Date?
  public init(ok: Bool, expiresAt: Date?) {
    self.ok = ok
    self.expiresAt = expiresAt
  }
}

/// サーバが 200 以外で返したときの、機械が読むエラー。
public struct WorkerServerError: Error, Equatable, Sendable {
  public let code: String
  public let status: Int
  public init(code: String, status: Int) {
    self.code = code
    self.status = status
  }
}

/// 診断画面に見せるためのスナップショット。
public struct WorkerClientDescription: Equatable, Sendable {
  public let baseURL: String
  public let attestSupported: Bool
  public let state: WorkerAuthState
  public init(baseURL: String, attestSupported: Bool, state: WorkerAuthState) {
    self.baseURL = baseURL
    self.attestSupported = attestSupported
    self.state = state
  }
}

/// `WorkerClient`(実物)と `CannedWorkerClient`(UI テスト)の共通面。合成の根と診断画面は
/// この面だけを見る —— どちらの実装かは `WorkerAvailability` だけが知る。
public protocol WorkerAuthenticating: Sendable {
  func describe() async -> WorkerClientDescription
  /// 有効なセッションを確かめる(無ければ attest / assert で取り直す)。
  func ensureSession() async -> WorkerAuthState
  func ping() async -> WorkerPingResult
  /// 検証済みの場所解決。失敗・未認証・到達不能はすべて nil(=呼び出し側はローカルへ代替)。
  func resolvePlaces(_ payload: PlaceResolutionRequestPayload) async -> PlaceResolutionResult?
  /// 検証済みの場所サジェスト。失敗・未認証・到達不能はすべて nil(=呼び出し側は Apple のみ)。
  func suggestPlaces(_ payload: PlaceSuggestionRequestPayload) async -> PlaceSuggestionResult?
  /// 検証済みの実経路。失敗・未認証・到達不能はすべて nil(=呼び出し側は Apple へ代替)。
  func liveRoutes(_ payload: LiveRoutesRequestPayload) async -> LiveRoutesResult?
  /// 検証済みの食事候補。失敗・未認証・到達不能はすべて nil(=呼び出し側は候補なし)。
  func foodRecommendations(_ payload: FoodRecommendationRequestPayload) async -> FoodRecommendationResult?
  /// 検証済み場所の詳細。失敗・未認証・到達不能はすべて nil(=呼び出し側は詳細なし)。
  func placeIntelligence(_ payload: PlaceIntelligenceRequestPayload) async -> PlaceIntelligenceResult?
  /// 検証済みの宿候補。失敗・未認証・到達不能はすべて nil。
  func hotelRecommendations(_ payload: HotelRecommendationRequestPayload) async -> HotelRecommendationResult?
  /// 経路沿いの寄り道候補。失敗・未認証・到達不能はすべて nil。
  func routeRecommendations(_ payload: RouteRecommendationRequestPayload) async -> RouteRecommendationResult?
}
