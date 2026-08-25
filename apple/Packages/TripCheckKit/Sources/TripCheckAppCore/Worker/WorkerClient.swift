import Foundation
import CryptoKit

/// アプリ ↔ Worker の認証を仕切る。入場は App Attest、以降は短命セッショントークン。
/// 旅程には触れない。トークンはメモリにだけ持ち、Keychain に残すのは keyId だけ。
public actor WorkerClient: WorkerAuthenticating {
  private let baseURL: URL
  private let attestor: any AppAttesting
  private let transport: any WorkerTransport
  private let keyStore: any AttestKeyStore
  private let bypassToken: String?

  private var sessionToken: String?
  private var state: WorkerAuthState = .idle

  public init(
    baseURL: URL,
    attestor: any AppAttesting,
    transport: any WorkerTransport,
    keyStore: any AttestKeyStore,
    bypassToken: String? = nil
  ) {
    self.baseURL = baseURL
    self.attestor = attestor
    self.transport = transport
    self.keyStore = keyStore
    self.bypassToken = bypassToken
  }

  public func describe() async -> WorkerClientDescription {
    WorkerClientDescription(baseURL: baseURL.absoluteString, attestSupported: attestor.isSupported, state: state)
  }

  public func ensureSession() async -> WorkerAuthState {
    if case .authenticated(let expiresAt) = state, sessionToken != nil, expiresAt.timeIntervalSinceNow > 60 {
      return state
    }
    return await authenticate(allowKeyReset: true)
  }

  public func ping() async -> WorkerPingResult {
    let auth = await ensureSession()
    guard case .authenticated = auth, let token = sessionToken else {
      return WorkerPingResult(ok: false, expiresAt: nil)
    }
    if let result = await pingOnce(token: token) { return result }
    // 401 のときは 1 度だけ取り直して再送。
    sessionToken = nil
    state = .idle
    let reauth = await authenticate(allowKeyReset: true)
    guard case .authenticated = reauth, let fresh = sessionToken else {
      return WorkerPingResult(ok: false, expiresAt: nil)
    }
    return await pingOnce(token: fresh) ?? WorkerPingResult(ok: false, expiresAt: nil)
  }

  /// 200 なら結果、401 なら nil(取り直しの合図)、その他は ok:false。
  private func pingOnce(token: String) async -> WorkerPingResult? {
    do {
      let response = try await transport.send(
        WorkerRequest(path: "/api/app/ping", method: "GET", sessionToken: token),
        baseURL: baseURL
      )
      if response.status == 200 {
        let decoded = try JSONDecoder().decode(PingResponse.self, from: response.body)
        return WorkerPingResult(ok: decoded.ok, expiresAt: Date(timeIntervalSince1970: decoded.expiresAt))
      }
      if response.status == 401 { return nil }
      return WorkerPingResult(ok: false, expiresAt: nil)
    } catch {
      return WorkerPingResult(ok: false, expiresAt: nil)
    }
  }

  public func resolvePlaces(_ payload: PlaceResolutionRequestPayload) async -> PlaceResolutionResult? {
    let auth = await ensureSession()
    guard case .authenticated = auth, let token = sessionToken else { return nil }
    guard let body = try? JSONEncoder().encode(payload) else { return nil }
    switch await resolvePlacesOnce(token: token, body: body) {
    case .resolved(let result): return result
    case .failed: return nil
    case .unauthorized:
      // 401 のときは 1 度だけ取り直して再送。
      sessionToken = nil
      state = .idle
      let reauth = await authenticate(allowKeyReset: true)
      guard case .authenticated = reauth, let fresh = sessionToken else { return nil }
      if case .resolved(let result) = await resolvePlacesOnce(token: fresh, body: body) { return result }
      return nil
    }
  }

  private enum ResolveOnce {
    case resolved(PlaceResolutionResult)
    case unauthorized
    case failed
  }

  /// 200→結果、401→取り直しの合図、その他/例外→failed(ローカル代替)。
  private func resolvePlacesOnce(token: String, body: Data) async -> ResolveOnce {
    do {
      let response = try await transport.send(
        WorkerRequest(path: "/api/place-resolution", method: "POST", body: body, sessionToken: token),
        baseURL: baseURL
      )
      if response.status == 200 {
        guard let decoded = try? JSONDecoder().decode(PlaceResolutionResult.self, from: response.body) else { return .failed }
        return .resolved(decoded)
      }
      if response.status == 401 { return .unauthorized }
      return .failed
    } catch {
      return .failed
    }
  }

  public func suggestPlaces(_ payload: PlaceSuggestionRequestPayload) async -> PlaceSuggestionResult? {
    let auth = await ensureSession()
    guard case .authenticated = auth, let token = sessionToken else { return nil }
    guard let body = try? JSONEncoder().encode(payload) else { return nil }
    switch await suggestPlacesOnce(token: token, body: body) {
    case .resolved(let result): return result
    case .failed: return nil
    case .unauthorized:
      // 401 のときは 1 度だけ取り直して再送。
      sessionToken = nil
      state = .idle
      let reauth = await authenticate(allowKeyReset: true)
      guard case .authenticated = reauth, let fresh = sessionToken else { return nil }
      if case .resolved(let result) = await suggestPlacesOnce(token: fresh, body: body) { return result }
      return nil
    }
  }

  private enum SuggestOnce {
    case resolved(PlaceSuggestionResult)
    case unauthorized
    case failed
  }

  /// 200→結果、401→取り直しの合図、その他/例外→failed(Apple のみへ代替)。
  private func suggestPlacesOnce(token: String, body: Data) async -> SuggestOnce {
    do {
      let response = try await transport.send(
        WorkerRequest(path: "/api/place-suggestions", method: "POST", body: body, sessionToken: token),
        baseURL: baseURL
      )
      if response.status == 200 {
        guard let decoded = try? JSONDecoder().decode(PlaceSuggestionResult.self, from: response.body) else { return .failed }
        return .resolved(decoded)
      }
      if response.status == 401 { return .unauthorized }
      return .failed
    } catch {
      return .failed
    }
  }

  public func liveRoutes(_ payload: LiveRoutesRequestPayload) async -> LiveRoutesResult? {
    let auth = await ensureSession()
    guard case .authenticated = auth, let token = sessionToken else { return nil }
    guard let body = try? JSONEncoder().encode(payload) else { return nil }
    switch await liveRoutesOnce(token: token, body: body) {
    case .resolved(let result): return result
    case .failed: return nil
    case .unauthorized:
      sessionToken = nil
      state = .idle
      let reauth = await authenticate(allowKeyReset: true)
      guard case .authenticated = reauth, let fresh = sessionToken else { return nil }
      if case .resolved(let result) = await liveRoutesOnce(token: fresh, body: body) { return result }
      return nil
    }
  }

  private enum LiveRoutesOnce {
    case resolved(LiveRoutesResult)
    case unauthorized
    case failed
  }

  private func liveRoutesOnce(token: String, body: Data) async -> LiveRoutesOnce {
    do {
      let response = try await transport.send(
        WorkerRequest(path: "/api/live-routes", method: "POST", body: body, sessionToken: token),
        baseURL: baseURL
      )
      if response.status == 200 {
        guard let decoded = try? JSONDecoder().decode(LiveRoutesResult.self, from: response.body) else { return .failed }
        return .resolved(decoded)
      }
      if response.status == 401 { return .unauthorized }
      return .failed
    } catch {
      return .failed
    }
  }

  public func foodRecommendations(_ payload: FoodRecommendationRequestPayload) async -> FoodRecommendationResult? {
    let auth = await ensureSession()
    guard case .authenticated = auth, let token = sessionToken else { return nil }
    guard let body = try? JSONEncoder().encode(payload) else { return nil }
    switch await foodRecommendationsOnce(token: token, body: body) {
    case .resolved(let result): return result
    case .failed: return nil
    case .unauthorized:
      sessionToken = nil
      state = .idle
      let reauth = await authenticate(allowKeyReset: true)
      guard case .authenticated = reauth, let fresh = sessionToken else { return nil }
      if case .resolved(let result) = await foodRecommendationsOnce(token: fresh, body: body) { return result }
      return nil
    }
  }

  private enum FoodOnce {
    case resolved(FoodRecommendationResult)
    case unauthorized
    case failed
  }

  private func foodRecommendationsOnce(token: String, body: Data) async -> FoodOnce {
    do {
      let response = try await transport.send(
        WorkerRequest(path: "/api/food-recommendations", method: "POST", body: body, sessionToken: token),
        baseURL: baseURL
      )
      if response.status == 200 {
        guard let decoded = try? JSONDecoder().decode(FoodRecommendationResult.self, from: response.body) else { return .failed }
        return .resolved(decoded)
      }
      if response.status == 401 { return .unauthorized }
      return .failed
    } catch {
      return .failed
    }
  }

  public func placeIntelligence(_ payload: PlaceIntelligenceRequestPayload) async -> PlaceIntelligenceResult? {
    let auth = await ensureSession()
    guard case .authenticated = auth, let token = sessionToken else { return nil }
    guard let body = try? JSONEncoder().encode(payload) else { return nil }
    switch await placeIntelligenceOnce(token: token, body: body) {
    case .resolved(let result): return result
    case .failed: return nil
    case .unauthorized:
      sessionToken = nil
      state = .idle
      let reauth = await authenticate(allowKeyReset: true)
      guard case .authenticated = reauth, let fresh = sessionToken else { return nil }
      if case .resolved(let result) = await placeIntelligenceOnce(token: fresh, body: body) { return result }
      return nil
    }
  }

  private enum IntelOnce {
    case resolved(PlaceIntelligenceResult)
    case unauthorized
    case failed
  }

  private func placeIntelligenceOnce(token: String, body: Data) async -> IntelOnce {
    do {
      let response = try await transport.send(
        WorkerRequest(path: "/api/place-intelligence", method: "POST", body: body, sessionToken: token),
        baseURL: baseURL
      )
      if response.status == 200 {
        guard let decoded = try? JSONDecoder().decode(PlaceIntelligenceResult.self, from: response.body) else { return .failed }
        return .resolved(decoded)
      }
      if response.status == 401 { return .unauthorized }
      return .failed
    } catch {
      return .failed
    }
  }

  public func hotelRecommendations(_ payload: HotelRecommendationRequestPayload) async -> HotelRecommendationResult? {
    let auth = await ensureSession()
    guard case .authenticated = auth, let token = sessionToken else { return nil }
    guard let body = try? JSONEncoder().encode(payload) else { return nil }
    switch await hotelRecommendationsOnce(token: token, body: body) {
    case .resolved(let result): return result
    case .failed: return nil
    case .unauthorized:
      sessionToken = nil
      state = .idle
      let reauth = await authenticate(allowKeyReset: true)
      guard case .authenticated = reauth, let fresh = sessionToken else { return nil }
      if case .resolved(let result) = await hotelRecommendationsOnce(token: fresh, body: body) { return result }
      return nil
    }
  }

  private enum HotelOnce {
    case resolved(HotelRecommendationResult)
    case unauthorized
    case failed
  }

  private func hotelRecommendationsOnce(token: String, body: Data) async -> HotelOnce {
    do {
      let response = try await transport.send(
        WorkerRequest(path: "/api/hotel-recommendations", method: "POST", body: body, sessionToken: token),
        baseURL: baseURL
      )
      if response.status == 200 {
        guard let decoded = try? JSONDecoder().decode(HotelRecommendationResult.self, from: response.body) else { return .failed }
        return .resolved(decoded)
      }
      if response.status == 401 { return .unauthorized }
      return .failed
    } catch {
      return .failed
    }
  }

  private func authenticate(allowKeyReset: Bool) async -> WorkerAuthState {
    state = .authenticating
    if let bypassToken, !attestor.isSupported {
      return await performBypass(bypassToken)
    }
    guard attestor.isSupported else {
      state = .failed(.attestUnsupported)
      return state
    }
    do {
      let storedKey = try? keyStore.loadKeyId()
      let challenge = try await fetchChallenge()
      let clientDataHash = Data(SHA256.hash(data: Data(challenge.utf8)))
      if let keyId = storedKey {
        let assertion: Data
        do {
          assertion = try await attestor.assert(keyId: keyId, clientDataHash: clientDataHash)
        } catch AppAttestError.keyInvalid {
          return await resetAndRetry(allowKeyReset: allowKeyReset, fallback: .attestUnsupported)
        }
        do {
          let session = try await postSession(
            path: "/api/app/assert",
            payload: AssertPayload(keyId: keyId, assertion: assertion.base64EncodedString(), challenge: challenge)
          )
          return applySession(session)
        } catch let error as WorkerServerError where error.code == "unknown_key" && allowKeyReset {
          return await resetAndRetry(allowKeyReset: true, fallback: .server(code: "unknown_key"))
        }
      } else {
        let keyId = try await attestor.generateKey()
        try keyStore.saveKeyId(keyId)
        let attestation = try await attestor.attest(keyId: keyId, clientDataHash: clientDataHash)
        let session = try await postSession(
          path: "/api/app/attest",
          payload: AttestPayload(keyId: keyId, attestation: attestation.base64EncodedString(), challenge: challenge)
        )
        return applySession(session)
      }
    } catch is CancellationError {
      state = .idle
      return state
    } catch let error as WorkerServerError {
      state = .failed(.server(code: error.code))
      return state
    } catch {
      state = .failed(.network)
      return state
    }
  }

  private func resetAndRetry(allowKeyReset: Bool, fallback: WorkerAuthFailure) async -> WorkerAuthState {
    guard allowKeyReset else {
      state = .failed(fallback)
      return state
    }
    try? keyStore.deleteKeyId()
    return await authenticate(allowKeyReset: false)
  }

  private func performBypass(_ token: String) async -> WorkerAuthState {
    do {
      let challenge = try await fetchChallenge()
      let session = try await postSession(
        path: "/api/app/attest",
        payload: BypassPayload(bypassToken: token, challenge: challenge)
      )
      return applySession(session)
    } catch is CancellationError {
      state = .idle
      return state
    } catch let error as WorkerServerError {
      state = .failed(.server(code: error.code))
      return state
    } catch {
      state = .failed(.network)
      return state
    }
  }

  private func applySession(_ response: SessionResponse) -> WorkerAuthState {
    sessionToken = response.session
    state = .authenticated(expiresAt: Date(timeIntervalSince1970: response.expiresAt))
    return state
  }

  private func fetchChallenge() async throws -> String {
    let response = try await transport.send(
      WorkerRequest(path: "/api/app/challenge", method: "POST", body: Data("{}".utf8)),
      baseURL: baseURL
    )
    guard response.status == 200 else { throw Self.serverError(response) }
    return try JSONDecoder().decode(ChallengeResponse.self, from: response.body).challenge
  }

  private func postSession(path: String, payload: some Encodable) async throws -> SessionResponse {
    let body = try JSONEncoder().encode(payload)
    let response = try await transport.send(
      WorkerRequest(path: path, method: "POST", body: body),
      baseURL: baseURL
    )
    guard response.status == 200 else { throw Self.serverError(response) }
    return try JSONDecoder().decode(SessionResponse.self, from: response.body)
  }

  private static func serverError(_ response: WorkerResponse) -> WorkerServerError {
    let code = (try? JSONDecoder().decode(ErrorResponse.self, from: response.body).code) ?? "http_\(response.status)"
    return WorkerServerError(code: code, status: response.status)
  }

  private struct AttestPayload: Encodable { let keyId: String; let attestation: String; let challenge: String }
  private struct AssertPayload: Encodable { let keyId: String; let assertion: String; let challenge: String }
  private struct BypassPayload: Encodable { let bypassToken: String; let challenge: String }
  private struct ChallengeResponse: Decodable { let challenge: String }
  private struct SessionResponse: Decodable { let session: String; let expiresAt: Double }
  private struct PingResponse: Decodable { let ok: Bool; let expiresAt: Double }
  private struct ErrorResponse: Decodable { let code: String }
}
