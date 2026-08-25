import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// `-workerDiagnostics` で起動したときだけ出る、開発用の接続診断。通常の旅行者には存在
/// しない。実機手順書と UI テストの観測点で、状態と `ping` の結果だけを見せる。
struct WorkerDiagnosticsScreen: View {
  let client: any WorkerAuthenticating

  @State private var snapshot: WorkerClientDescription?
  @State private var pingLine: String?
  @State private var checking = false

  private var copy: AppCopy { AppCopy.for(.ja) }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(copy.workerDiagnosticsTitle)
        .tcFont(.stopName)
        .foregroundStyle(Tokens.Color.ink)
        .accessibilityIdentifier("diag.title")

      if let snapshot {
        infoRow("Worker URL", snapshot.baseURL, id: "diag.url")
        infoRow("App Attest", snapshot.attestSupported ? "yes" : "no", id: "diag.support")
        infoRow("State", stateLabel(snapshot.state), id: "diag.state")
      }

      if let pingLine {
        Text(pingLine)
          .tcFont(.stats)
          .foregroundStyle(Tokens.Color.ink)
          .accessibilityIdentifier("diag.pingResult")
      }

      Button(copy.workerDiagnosticsCheck) { Task { await runCheck() } }
        .buttonStyle(.primaryAccent)
        .tcFont(.stats)
        .disabled(checking)
        .accessibilityIdentifier("diag.check")

      Spacer(minLength: 0)
    }
    .padding(20)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .background(Tokens.Color.bg)
    // `map`/`toast` と同じ流儀:コンテナ自身をアクセシビリティ要素にしないと、
    // XCUITest から `otherElements["diag.screen"]` として見つからない。
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("diag.screen")
    .task { snapshot = await client.describe() }
  }

  private func infoRow(_ label: String, _ value: String, id: String) -> some View {
    HStack(alignment: .firstTextBaseline) {
      Text(label)
        .tcFont(.stats)
        .foregroundStyle(Tokens.Color.muted)
      Spacer(minLength: 12)
      Text(value)
        .tcFont(.stats)
        .foregroundStyle(Tokens.Color.ink)
        .multilineTextAlignment(.trailing)
    }
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier(id)
  }

  private func runCheck() async {
    checking = true
    let result = await client.ping()
    pingLine = result.ok ? copy.workerDiagnosticsReachable : copy.workerDiagnosticsUnreachable
    snapshot = await client.describe()
    checking = false
  }

  private func stateLabel(_ state: WorkerAuthState) -> String {
    switch state {
    case .idle: return "idle"
    case .authenticating: return "authenticating"
    case .authenticated: return "authenticated"
    case .failed(let failure):
      switch failure {
      case .attestUnsupported: return "unsupported"
      case .network: return "network"
      case .server(let code): return code
      }
    }
  }
}
