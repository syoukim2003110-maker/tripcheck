import Foundation

/// どのクライアントを使うかは、ここ(合成の根から呼ぶ 1 か所)だけで決める ——
/// `IntentAvailability` と同じ流儀。ストアや画面は `any WorkerAuthenticating` しか見ない。
public enum WorkerAvailability {
  public static func makeDefaultClient(
    uiTesting: Bool,
    baseURL: URL,
    bypassToken: String?
  ) -> any WorkerAuthenticating {
    if uiTesting { return CannedWorkerClient() }
    return WorkerClient(
      baseURL: baseURL,
      attestor: DeviceCheckAttestor(),
      transport: URLSessionWorkerTransport(),
      keyStore: KeychainAttestKeyStore(),
      bypassToken: bypassToken
    )
  }
}
