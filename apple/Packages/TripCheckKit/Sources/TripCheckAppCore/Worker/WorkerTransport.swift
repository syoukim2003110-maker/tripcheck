import Foundation

/// Worker への 1 往復。`baseURL` は呼び出し側が持ち、`path` は `/api/app/...`。
public struct WorkerRequest: Sendable {
  public let path: String
  public let method: String
  public let body: Data?
  public let sessionToken: String?
  public init(path: String, method: String, body: Data? = nil, sessionToken: String? = nil) {
    self.path = path
    self.method = method
    self.body = body
    self.sessionToken = sessionToken
  }
}

public struct WorkerResponse: Sendable {
  public let status: Int
  public let body: Data
  public init(status: Int, body: Data) {
    self.status = status
    self.body = body
  }
}

/// 通信の面。テストは `URLSession` を使わないフェイクに差し替える。
public protocol WorkerTransport: Sendable {
  func send(_ request: WorkerRequest, baseURL: URL) async throws -> WorkerResponse
}

public struct URLSessionWorkerTransport: WorkerTransport {
  private let session: URLSession
  public init(session: URLSession = .shared) {
    self.session = session
  }

  public func send(_ request: WorkerRequest, baseURL: URL) async throws -> WorkerResponse {
    guard let url = URL(string: request.path, relativeTo: baseURL) else { throw URLError(.badURL) }
    var urlRequest = URLRequest(url: url)
    urlRequest.httpMethod = request.method
    if let body = request.body {
      urlRequest.httpBody = body
      urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    if let token = request.sessionToken {
      urlRequest.setValue(token, forHTTPHeaderField: "X-TripCheck-App-Session")
    }
    let (data, response) = try await session.data(for: urlRequest)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    return WorkerResponse(status: status, body: data)
  }
}
