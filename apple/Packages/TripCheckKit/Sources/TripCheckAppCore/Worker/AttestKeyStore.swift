import Foundation
import Security

/// keyId(公開値のハッシュ)だけを端末に残す面。トークンや鍵素材は保存しない。
public protocol AttestKeyStore: Sendable {
  func loadKeyId() throws -> String?
  func saveKeyId(_ keyId: String) throws
  func deleteKeyId() throws
}

/// Keychain 版。service は固定、account は 1 つ。
public struct KeychainAttestKeyStore: AttestKeyStore {
  private let service: String
  private let account = "attest-key-id"
  public init(service: String = "com.muraoshoki.tripcheck.worker") {
    self.service = service
  }

  private func baseQuery() -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
  }

  public func loadKeyId() throws -> String? {
    var query = baseQuery()
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = item as? Data else {
      throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
    }
    return String(data: data, encoding: .utf8)
  }

  public func saveKeyId(_ keyId: String) throws {
    let data = Data(keyId.utf8)
    let status = SecItemUpdate(baseQuery() as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecSuccess { return }
    if status == errSecItemNotFound {
      var insert = baseQuery()
      insert[kSecValueData as String] = data
      insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      let addStatus = SecItemAdd(insert as CFDictionary, nil)
      guard addStatus == errSecSuccess else {
        throw NSError(domain: NSOSStatusErrorDomain, code: Int(addStatus))
      }
      return
    }
    throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
  }

  public func deleteKeyId() throws {
    let status = SecItemDelete(baseQuery() as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
    }
  }
}
