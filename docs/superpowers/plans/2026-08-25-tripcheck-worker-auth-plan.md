# TripCheck Worker 認証 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** iOS アプリが App Attest で身元を証明し、既存 Cloudflare Worker から短命セッションを得て `GET /api/app/ping` を通す認証基盤を作る。

**Architecture:** Worker 側は `worker/index.ts` に `/api/app/*` の早期分岐を 1 箇所足し、検証ロジックは `lib/server/app-attest/`(WebCrypto のみ・依存追加ゼロ)へ新設。アプリ側は AppCore に `WorkerClient`(actor)+ App Attest / 通信 / Keychain の 3 プロトコル + 診断画面を足す(TripCheckKit は不変)。可用性判定は composition root だけで行う既存パターン(`IntentAvailability`)の写し。

**Tech Stack:** TypeScript(Node 22 `--experimental-strip-types` + Cloudflare Workers、WebCrypto)、Swift 6(AppCore、DeviceCheck / CryptoKit / Security)。

**Spec:** `docs/superpowers/specs/2026-08-25-tripcheck-worker-auth-design.md`

**検証済み参照実装(重要):** web 側 10 ファイル + テスト 2 ファイルは本計画執筆時に
`node --experimental-strip-types --test` で **5/5 緑**を確認済み。正本は
`/Users/muraoshoki/.claude/jobs/ca26b62e/tmp/worker-auth-ref/` 配下にある。
Task 1〜4 の web ファイルは、この参照を**逐語コピー**し、テストで緑を再確認するのが仕事。
参照が読めない場合のみ本文中のコードから起こす。合成ミニ CA が手書き CBOR/DER/WebCrypto
検証器を通って attest→assert→ping まで流れることを実測済みなので、暗号ロジックは新規発明しない。

## Global Constraints

- web: 既存ファイルの変更は `worker/index.ts`(分岐 1 箇所)と `.env.example`(追記)のみ。それ以外は新規ファイル。**既存テストは 1 本も変えず全緑を維持**。依存パッケージ追加ゼロ。暗号は WebCrypto(`globalThis.crypto.subtle`)のみ。テストヘルパに限り `node:crypto` 可。TS は strip-only 互換(パラメータプロパティ・enum・namespace 禁止)。
- apple: **TripCheckKit は 1 行も変えない**。AppCore は additive(既存 public API 変更禁止)。`PlannerCopy` 267 キー不変。fixtures バイト同一。Swift 6 strict concurrency・新規警告ゼロ。日本語文リテラルは `AppCopy.swift` のみ(CopyBoundaryTests)。絵文字禁止。
- 秘密(セッショントークン・アテステーション・鍵素材)をログ・永続化に出さない。UserDefaults に何も書かない。Keychain に置くのは keyId のみ。
- App ID = `T8L5BPC2XJ.com.muraoshoki.tripcheck`(team T8L5BPC2XJ / bundle com.muraoshoki.tripcheck)。
- コミットは末尾に必ず次の 2 行トレーラを付ける。`git push` はしない。

```
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J
```

## File Structure

**web(新規、`lib/server/app-attest/`):** `bytes.ts`(byte/base64/hash 補助)・`cbor.ts`(最小 CBOR デコーダ)・`der.ts`(最小 DER/X.509 読取)・`certificate-chain.ts`(チェーン検証 + Apple ルート定数)・`app-session.ts`(challenge/session の HMAC 発行検証)・`attestation.ts`(attest 検証)・`assertion.ts`(assert 検証)・`key-store.ts`(D1 + process-local 台帳)・`gateway.ts`(4 ルート + `handleAppGateway`)。テスト: `tests/helpers/app-attest-fixtures.ts`(合成ミニ CA)・`tests/app-attest-gateway.test.ts`。既存改変: `worker/index.ts`・`.env.example`。

**apple(新規、`apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/`):** `WorkerAuthState.swift`・`AppAttestor.swift`・`WorkerTransport.swift`・`AttestKeyStore.swift`・`WorkerClient.swift`・`CannedWorkerClient.swift`・`WorkerAvailability.swift`。アプリ本体: `apple/TripCheck/Screens/Diagnostics/WorkerDiagnosticsScreen.swift`(新規)・`apple/TripCheck/Resources/TripCheck.entitlements`(新規)。既存改変: `apple/TripCheck/App/TripCheckApp.swift`・`apple/TripCheck/Resources/Info.plist`・`apple/project.yml`・AppCore `Presentation/AppCopy.swift`。テスト: AppCore `Tests/.../WorkerClientTests.swift` + `Support/Fakes.swift` 追記、`apple/TripCheckUITests/PlannerFlowTests.swift` 追記。手順書: `apple/docs/worker-auth-device-checklist.md`。

---
## Task 1: App Attest 低レベル基盤(bytes / cbor / der)

**Files:**
- Create: `lib/server/app-attest/bytes.ts`, `lib/server/app-attest/cbor.ts`, `lib/server/app-attest/der.ts`
- Test: `tests/app-attest-primitives.test.ts`

**Interfaces:**
- Produces: `bytes.ts` → `bytesEqual`, `concatBytes`, `sha256`, `sha256Utf8`, `bytesToBase64Url`, `base64ToBytes`, `randomHex`。`cbor.ts` → `decodeCbor`, `CborError`, `cborMap/cborBytes/cborText/cborArray`, 型 `CborValue/CborMap`。`der.ts` → `readNode`, `children`, `content`, `wholeNode`, `decodeOid`, `decodeTime`, `ecdsaSignatureToRaw`, `DerError`, 型 `DerNode`。

**検証済み参照:** `/Users/muraoshoki/.claude/jobs/ca26b62e/tmp/worker-auth-ref/lib/server/app-attest/{bytes,cbor,der}.ts`(strip-only 互換・テスト緑済み)。

- [ ] **Step 1: 3 ファイルを参照から逐語コピー**

`/Users/muraoshoki/.claude/jobs/ca26b62e/tmp/worker-auth-ref/lib/server/app-attest/bytes.ts`, `cbor.ts`, `der.ts` を同名でコピーする。
`cbor.ts` の `CborReader` は **パラメータプロパティを使わない**形(フィールド宣言 + 代入)であることを確認する(strip-only 制約)。コピー後 `diff` でバイト一致を確認:

Run: `diff -q /Users/muraoshoki/.claude/jobs/ca26b62e/tmp/worker-auth-ref/lib/server/app-attest/bytes.ts lib/server/app-attest/bytes.ts && diff -q /Users/muraoshoki/.claude/jobs/ca26b62e/tmp/worker-auth-ref/lib/server/app-attest/cbor.ts lib/server/app-attest/cbor.ts && diff -q /Users/muraoshoki/.claude/jobs/ca26b62e/tmp/worker-auth-ref/lib/server/app-attest/der.ts lib/server/app-attest/der.ts`
Expected: 3 ファイルとも差分なし

- [ ] **Step 2: 単体テストを書く**

`tests/app-attest-primitives.test.ts` を作る。CBOR ラウンドトリップ(手組みバイト列 → map/array/bytes/text/uint)、DER の OID デコード(`1.2.840.10045.2.1` を手組みバイトから)、`base64ToBytes`/`bytesToBase64Url` の相互変換(標準・URL安全・パディング有無)、`ecdsaSignatureToRaw`(DER SEQUENCE of 2 INTEGER → 64 バイト、先頭ゼロ除去含む)、`decodeTime`(UTCTime `250101000000Z` と GeneralizedTime)を assert。各テストは既存テストの書式(`node:test` + `node:assert/strict`)に合わせる。

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { decodeCbor, cborMap, cborBytes } from "../lib/server/app-attest/cbor.ts";
import { readNode, decodeOid, ecdsaSignatureToRaw } from "../lib/server/app-attest/der.ts";
import { base64ToBytes, bytesToBase64Url } from "../lib/server/app-attest/bytes.ts";

test("CBOR decodes a string-keyed map of bytes", () => {
  // { "a": h'01FF' } => A1 61 61 42 01 FF
  const decoded = cborMap(decodeCbor(Uint8Array.of(0xa1, 0x61, 0x61, 0x42, 0x01, 0xff)), "root");
  assert.deepEqual([...cborBytes(decoded.get("a"), "a")], [0x01, 0xff]);
});

test("base64 round-trips through URL-safe and standard alphabets", () => {
  const bytes = Uint8Array.of(251, 239, 190, 0, 1, 2);
  const url = bytesToBase64Url(bytes);
  assert.equal(url.includes("+") || url.includes("/") || url.includes("="), false);
  assert.deepEqual([...(base64ToBytes(url) ?? [])], [...bytes]);
  assert.deepEqual([...(base64ToBytes("++/-_A==") ?? [])], [...(base64ToBytes("--_-_A") ?? [])]);
});

test("an OID decodes from its DER octets", () => {
  // 1.2.840.10045.2.1 => 06 07 2A 86 48 CE 3D 02 01
  const node = readNode(Uint8Array.of(0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01), 0);
  assert.equal(decodeOid(Uint8Array.of(0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01), node), "1.2.840.10045.2.1");
});

test("a DER ECDSA signature becomes fixed-width r||s", () => {
  // SEQUENCE { INTEGER 0x01, INTEGER 0x00FF } => 30 08 02 01 01 02 02 00 FF
  const raw = ecdsaSignatureToRaw(Uint8Array.of(0x30, 0x08, 0x02, 0x01, 0x01, 0x02, 0x02, 0x00, 0xff), 32);
  assert.equal(raw.length, 64);
  assert.equal(raw[31], 0x01);
  assert.equal(raw[63], 0xff);
});
```

- [ ] **Step 3: テストを走らせて緑を確認**

Run: `node --experimental-strip-types --test tests/app-attest-primitives.test.ts`
Expected: 全 pass、fail 0

- [ ] **Step 4: コミット**

```bash
git add lib/server/app-attest/bytes.ts lib/server/app-attest/cbor.ts lib/server/app-attest/der.ts tests/app-attest-primitives.test.ts
git commit -m "The gateway learns to read bytes, CBOR and DER before it trusts any"
```

## Task 2: 証明書チェーンとセッション発行(certificate-chain / app-session)

**Files:**
- Create: `lib/server/app-attest/certificate-chain.ts`, `lib/server/app-attest/app-session.ts`
- Test: `tests/app-attest-session.test.ts`

**Interfaces:**
- Consumes: Task 1 の bytes/der。既存 `lib/server/hmac-signature.ts` の `signingSecret`, `hmacBase64Url`, 型 `SigningEnvironment`。
- Produces: `certificate-chain.ts` → `APPLE_APP_ATTEST_ROOT_CA_PEM`, `appleAppAttestRootDer()`, `pemToDer`, `parseCertificate`, `verifyCertificateChain`, 型 `ParsedCertificate/EcCurve`。`app-session.ts` → `issueChallenge`, `verifyChallenge`, `issueSession`, `verifySession`, 定数 `CHALLENGE_TTL_SECONDS/SESSION_TTL_SECONDS` 等、型 `ChallengeVerdict/SessionVerdict`。

**検証済み参照:** `/Users/muraoshoki/.claude/jobs/ca26b62e/tmp/worker-auth-ref/lib/server/app-attest/{certificate-chain,app-session}.ts`。Apple 本番ルート CA が `parseCertificate` を通ること(P-384・2045-03-15 失効)も実測済み。

- [ ] **Step 1: 2 ファイルを参照から逐語コピー**

Run: `diff -q /Users/muraoshoki/.claude/jobs/ca26b62e/tmp/worker-auth-ref/lib/server/app-attest/certificate-chain.ts lib/server/app-attest/certificate-chain.ts && diff -q /Users/muraoshoki/.claude/jobs/ca26b62e/tmp/worker-auth-ref/lib/server/app-attest/app-session.ts lib/server/app-attest/app-session.ts`
Expected: 差分なし

- [ ] **Step 2: 単体テストを書く**

`tests/app-attest-session.test.ts`:
- `parseCertificate(appleAppAttestRootDer())` が `curve === "P-384"` かつ `notAfter` が 2045 年であること
- `issueChallenge` → `verifyChallenge` が同一秒で `ok:true`、TTL 超過(now + 4000 秒)で `challenge_expired`、署名改竄(末尾 1 文字変更)で `challenge_invalid`、秘密鍵なし env で `no_signing_secret`
- `issueSession` → `verifySession` が `ok:true` かつ `expiresAt` が now+86400、期限後(now+90000)で `session_expired`、keyId 差し替えで `session_invalid`

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { appleAppAttestRootDer, parseCertificate } from "../lib/server/app-attest/certificate-chain.ts";
import { issueChallenge, verifyChallenge, issueSession, verifySession } from "../lib/server/app-attest/app-session.ts";

const env = { TRIPCHECK_QUOTA_HASH_SECRET: "unit-test-signing-secret-value" };
const NOW = 1_760_000_000;

test("the Apple production root parses as a P-384 CA valid to 2045", () => {
  const root = parseCertificate(appleAppAttestRootDer());
  assert.equal(root.curve, "P-384");
  assert.ok(root.notAfter > Date.parse("2045-01-01T00:00:00Z") / 1000);
});

test("a challenge verifies fresh, expires late, and rejects tampering", async () => {
  const challenge = (await issueChallenge(env, NOW, "0".repeat(32)))!;
  assert.deepEqual(await verifyChallenge(env, challenge, NOW), { ok: true });
  assert.equal((await verifyChallenge(env, challenge, NOW + 4000)).ok, false);
  assert.equal((await verifyChallenge(env, challenge.slice(0, -1) + (challenge.at(-1) === "A" ? "B" : "A"), NOW)).ok, false);
  assert.deepEqual(await verifyChallenge({}, challenge, NOW), { ok: false, code: "no_signing_secret" });
});

test("a session verifies before its expiry and fails after", async () => {
  const issued = (await issueSession(env, "abc123", NOW))!;
  assert.equal(issued.expiresAt, NOW + 86_400);
  const ok = await verifySession(env, issued.session, NOW + 10);
  assert.equal(ok.ok, true);
  assert.equal((await verifySession(env, issued.session, NOW + 90_000)).ok, false);
});
```

- [ ] **Step 3: テスト緑を確認**

Run: `node --experimental-strip-types --test tests/app-attest-session.test.ts`
Expected: 全 pass

- [ ] **Step 4: コミット**

```bash
git add lib/server/app-attest/certificate-chain.ts lib/server/app-attest/app-session.ts tests/app-attest-session.test.ts
git commit -m "The chain climbs to Apple's root, and the door hands back a short-lived pass"
```

## Task 3: attest / assert 検証器と鍵台帳(attestation / assertion / key-store)

**Files:**
- Create: `lib/server/app-attest/attestation.ts`, `lib/server/app-attest/assertion.ts`, `lib/server/app-attest/key-store.ts`
- Test: Task 4 の統合テストで網羅する(この 3 つは gateway 経由で実行されるため、単独テストは設けない)

**Interfaces:**
- Consumes: Task 1(bytes/cbor/der)、Task 2(certificate-chain)。
- Produces: `attestation.ts` → `verifyAttestation`, `parseAuthenticatorData`, 型 `AttestEnvironment/AttestationVerdict/AuthenticatorData`。`assertion.ts` → `verifyAssertion`, 型 `AssertionVerdict`。`key-store.ts` → `APP_ATTEST_KEYS_SCHEMA_SQL`, `d1AppAttestKeyStore`, `processLocalAppAttestKeyStore`, `resetProcessLocalAppAttestKeys`, 型 `AppAttestKeyStore/AppAttestKeyRecord/D1DatabaseLike`。

**検証済み参照:** `/Users/muraoshoki/.claude/jobs/ca26b62e/tmp/worker-auth-ref/lib/server/app-attest/{attestation,assertion,key-store}.ts`。

- [ ] **Step 1: 3 ファイルを参照から逐語コピー**

Run: `diff -q /Users/muraoshoki/.claude/jobs/ca26b62e/tmp/worker-auth-ref/lib/server/app-attest/attestation.ts lib/server/app-attest/attestation.ts && diff -q /Users/muraoshoki/.claude/jobs/ca26b62e/tmp/worker-auth-ref/lib/server/app-attest/assertion.ts lib/server/app-attest/assertion.ts && diff -q /Users/muraoshoki/.claude/jobs/ca26b62e/tmp/worker-auth-ref/lib/server/app-attest/key-store.ts lib/server/app-attest/key-store.ts`
Expected: 差分なし

- [ ] **Step 2: 型注釈だけの健全性確認(コンパイルは gateway テストで)**

このタスク単独のテストは無い。3 ファイルが Task 1/2 の export だけに依存し、未定義シンボルを参照していないことを目視 + 次コマンドで確認する:

Run: `node --experimental-strip-types --check lib/server/app-attest/attestation.ts && node --experimental-strip-types --check lib/server/app-attest/assertion.ts && node --experimental-strip-types --check lib/server/app-attest/key-store.ts`
Expected: エラーなし(構文 OK)

- [ ] **Step 3: コミット**

```bash
git add lib/server/app-attest/attestation.ts lib/server/app-attest/assertion.ts lib/server/app-attest/key-store.ts
git commit -m "One proof to enrol a key, a lighter proof to return, a ledger to remember it"
```

## Task 4: ゲートウェイ + Worker 分岐 + 環境変数 + 統合テスト

**Files:**
- Create: `lib/server/app-attest/gateway.ts`, `tests/helpers/app-attest-fixtures.ts`, `tests/app-attest-gateway.test.ts`
- Modify: `worker/index.ts`(分岐 1 箇所), `.env.example`(4 変数追記)

**Interfaces:**
- Consumes: Task 1〜3 の全 export。既存 `worker/index.ts` の `fetch` ハンドラ、`secureResponse`。
- Produces: `gateway.ts` → `handleAppGateway`, `isAppGatewayPath`, `APP_GATEWAY_ROUTES`, `APP_SESSION_HEADER`, `BYPASS_KEY_ID`, 型 `AppGatewayEnvironment/AppGatewayDependencies`。

**検証済み参照:** `/Users/muraoshoki/.claude/jobs/ca26b62e/tmp/worker-auth-ref/lib/server/app-attest/gateway.ts`, `/Users/muraoshoki/.claude/jobs/ca26b62e/tmp/worker-auth-ref/tests/helpers/app-attest-fixtures.ts`, `/Users/muraoshoki/.claude/jobs/ca26b62e/tmp/worker-auth-ref/tests/app-attest-gateway.test.ts`(5/5 緑)。フィクスチャの拡張は `[3] EXPLICIT SEQUENCE OF Extension`(外側 SEQUENCE 込み)であること、gateway の assert 分岐が keyId を base64url に正規化してから `keyStore.get` すること、`base64ToBytes`/`bytesToBase64Url` は **静的 import**(動的 import 禁止)であることに注意。

- [ ] **Step 1: gateway とテスト 2 本を参照から逐語コピー**

Run: `diff -q /Users/muraoshoki/.claude/jobs/ca26b62e/tmp/worker-auth-ref/lib/server/app-attest/gateway.ts lib/server/app-attest/gateway.ts && diff -q /Users/muraoshoki/.claude/jobs/ca26b62e/tmp/worker-auth-ref/tests/helpers/app-attest-fixtures.ts tests/helpers/app-attest-fixtures.ts && diff -q /Users/muraoshoki/.claude/jobs/ca26b62e/tmp/worker-auth-ref/tests/app-attest-gateway.test.ts tests/app-attest-gateway.test.ts`
Expected: 差分なし

- [ ] **Step 2: `worker/index.ts` に早期分岐を足す**

`import` 群の末尾(既存の `place-photo-token` import の直後)に追加:

```ts
import { handleAppGateway, isAppGatewayPath } from "../lib/server/app-attest/gateway.ts";
```

`Env` interface に App Attest 用フィールドを追記(既存フィールドは残す):

```ts
  DB?: D1DatabaseLike;
  TRIPCHECK_APP_IDS?: string;
  TRIPCHECK_APP_ATTEST_ENVIRONMENTS?: string;
  TRIPCHECK_APP_ATTEST_BYPASS_TOKEN?: string;
  TRIPCHECK_APP_API_DISABLED?: string;
```

`worker.fetch` の本体、`const url = new URL(request.url);` の**直後**(paid ルート判定より前)に分岐を足す。`env` は `AppGatewayEnvironment` の要求を構造的に満たすので `as` キャストで渡す:

```ts
    if (isAppGatewayPath(url.pathname)) {
      const response = await handleAppGateway(request, env as unknown as import("../lib/server/app-attest/gateway.ts").AppGatewayEnvironment);
      return secureResponse(response, url);
    }
```

（`DB?` は既存 `Env` に既にあるため重複追記しないこと。無い場合のみ足す。）

- [ ] **Step 3: `.env.example` に 4 変数を空値で追記**

ファイル末尾に追記:

```
# App Attest gateway (/api/app/*). Native app auth; browser routes are unaffected.
# Allowed App IDs, comma-separated. Dev: T8L5BPC2XJ.com.muraoshoki.tripcheck
TRIPCHECK_APP_IDS=
# Allowed attestation environments: development,production (default production).
TRIPCHECK_APP_ATTEST_ENVIRONMENTS=
# Set ONLY in .dev.vars to let the Simulator skip real App Attest.
TRIPCHECK_APP_ATTEST_BYPASS_TOKEN=
# Non-empty disables /api/app/* entirely.
TRIPCHECK_APP_API_DISABLED=
```

- [ ] **Step 4: gateway 統合テストを走らせる**

Run: `node --experimental-strip-types --test tests/app-attest-gateway.test.ts`
Expected: tests 5 / pass 5 / fail 0(attest→ping、assert 単調増加と巻き戻し拒否、nonce改竄・App ID不一致・unknown_key、challenge/session期限・killswitch・no_signing_secret、bypass fail-closed）

- [ ] **Step 5: 既存 web テスト全体が緑のままを確認**

Run: `pnpm test`
Expected: 既存の golden / route-policy 網羅 / 他すべてが緑。特に `tests/api-route-policy-exhaustive.test.ts` が緑(= `/api/app/*` をマニフェストに載せていないので `app/api/**` と一致)。ビルド(`pnpm run build`)も通ること。

- [ ] **Step 6: コミット**

```bash
git add lib/server/app-attest/gateway.ts tests/helpers/app-attest-fixtures.ts tests/app-attest-gateway.test.ts worker/index.ts .env.example
git commit -m "The native door opens beside the browser's, and only a real device walks through"
```

## Task 5: AppCore の Worker 型・プロトコル・アダプタ

**Files:**
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/WorkerAuthState.swift`, `.../Worker/AppAttestor.swift`, `.../Worker/WorkerTransport.swift`, `.../Worker/AttestKeyStore.swift`
- Modify: `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/Support/Fakes.swift`(末尾に追記)

**Interfaces:**
- Produces: `WorkerAuthState`/`WorkerAuthFailure`/`WorkerPingResult`/`WorkerServerError`/`WorkerClientDescription`/`WorkerAuthenticating`(protocol)、`AppAttesting`(protocol)+`AppAttestError`+`DeviceCheckAttestor`、`WorkerTransport`(protocol)+`WorkerRequest`/`WorkerResponse`+`URLSessionWorkerTransport`、`AttestKeyStore`(protocol)+`KeychainAttestKeyStore`。テスト用: `FakeAttestor`/`FakeTransport`/`InMemoryAttestKeyStore`。
- Consumes: Foundation、CryptoKit(SHA256 は Task 6)、DeviceCheck、Security(Keychain)。

- [ ] **Step 1: `WorkerAuthState.swift` を作る**

```swift
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
}
```

- [ ] **Step 2: `AppAttestor.swift` を作る**

```swift
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
```

- [ ] **Step 3: `WorkerTransport.swift` を作る**

```swift
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
```

- [ ] **Step 4: `AttestKeyStore.swift` を作る**

```swift
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
```

- [ ] **Step 5: `Support/Fakes.swift` の末尾にテスト用フェイクを追記**

既存の `FakeIntentParser` などが定義されているファイルの末尾に足す(既存定義は変えない):

```swift
// MARK: - Worker 認証のフェイク(spec 2026-08-25)

struct FakeAttestor: AppAttesting {
  var supported = true
  var keyId = "fake-key-id"
  /// true なら `assert` が `keyInvalid` を投げ、keyId 破棄 → 再登録の自己回復を試させる。
  var assertInvalidates = false

  var isSupported: Bool { supported }
  func generateKey() async throws -> String { keyId }
  func attest(keyId: String, clientDataHash: Data) async throws -> Data { Data("attestation".utf8) }
  func assert(keyId: String, clientDataHash: Data) async throws -> Data {
    if assertInvalidates { throw AppAttestError.keyInvalid }
    return Data("assertion".utf8)
  }
}

/// `URLSession` を使わない通信。`handler` は純粋(状態は呼び出し側の actor に持たせる)。
struct FakeTransport: WorkerTransport {
  let handler: @Sendable (WorkerRequest) async throws -> WorkerResponse
  func send(_ request: WorkerRequest, baseURL: URL) async throws -> WorkerResponse {
    try await handler(request)
  }
}

final class InMemoryAttestKeyStore: AttestKeyStore, @unchecked Sendable {
  private let lock = NSLock()
  private var keyId: String?
  init(keyId: String? = nil) { self.keyId = keyId }
  func loadKeyId() throws -> String? { lock.withLock { keyId } }
  func saveKeyId(_ keyId: String) throws { lock.withLock { self.keyId = keyId } }
  func deleteKeyId() throws { lock.withLock { self.keyId = nil } }
  var storedKeyId: String? { lock.withLock { keyId } }
}
```

- [ ] **Step 6: AppCore がビルドされることを確認**

Run: `cd apple && swift build --package-path Packages/TripCheckKit`
Expected: エラーなし、新規警告ゼロ。(`Security`/`DeviceCheck` は iOS/macOS 双方で import 可能。macOS でビルドが通ること。)

- [ ] **Step 7: コミット**

```bash
cd apple
git add Packages/TripCheckKit/Sources/TripCheckAppCore/Worker Packages/TripCheckKit/Tests/TripCheckAppCoreTests/Support/Fakes.swift
git commit -m "The app learns the shapes of the door: a key, a wire, a state, a place to remember"
```

## Task 6: WorkerClient(actor)・CannedWorkerClient・WorkerAvailability + テスト

**Files:**
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/WorkerClient.swift`, `.../Worker/CannedWorkerClient.swift`, `.../Worker/WorkerAvailability.swift`
- Test: `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/WorkerClientTests.swift`

**Interfaces:**
- Consumes: Task 5 の全型。CryptoKit(`SHA256`)。
- Produces: `WorkerClient`(actor, `WorkerAuthenticating`)、`CannedWorkerClient`(actor, `WorkerAuthenticating`)、`WorkerAvailability.makeDefaultClient(uiTesting:baseURL:bypassToken:)`。

- [ ] **Step 1: `WorkerClient.swift` を作る**

```swift
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
```

- [ ] **Step 2: `CannedWorkerClient.swift` を作る**

```swift
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
}
```

- [ ] **Step 3: `WorkerAvailability.swift` を作る**

```swift
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
```

- [ ] **Step 4: `WorkerClientTests.swift` を書く**

`FakeGateway`(スクリプト可能な actor)で本物の HTTP を使わず状態遷移を確かめる。

```swift
import XCTest
import Foundation
@testable import TripCheckAppCore

/// テスト内で Worker の応答を組み立てる小さなゲートウェイ。challenge → session を返し、
/// 特定シナリオ(unknown_key を 1 回・ping 401 を 1 回)をスクリプトできる。
private actor FakeGateway {
  var unknownKeyOnce = false
  var pingUnauthorizedOnce = false
  var lastAttestKeyId: String?
  private var sawUnknownKey = false
  private var sawPing401 = false

  func configure(unknownKeyOnce: Bool = false, pingUnauthorizedOnce: Bool = false) {
    self.unknownKeyOnce = unknownKeyOnce
    self.pingUnauthorizedOnce = pingUnauthorizedOnce
  }

  func respond(to request: WorkerRequest) -> WorkerResponse {
    func json(_ text: String, _ status: Int) -> WorkerResponse {
      WorkerResponse(status: status, body: Data(text.utf8))
    }
    switch request.path {
    case "/api/app/challenge":
      return json(#"{"challenge":"v1.100.0000000000000000000000000000abcd.sig"}"#, 200)
    case "/api/app/attest":
      return json(#"{"session":"session-attest","expiresAt":4102444800}"#, 200)
    case "/api/app/assert":
      if unknownKeyOnce, !sawUnknownKey {
        sawUnknownKey = true
        return json(#"{"code":"unknown_key"}"#, 401)
      }
      return json(#"{"session":"session-assert","expiresAt":4102444800}"#, 200)
    case "/api/app/ping":
      if pingUnauthorizedOnce, !sawPing401 {
        sawPing401 = true
        return json(#"{"code":"session_expired"}"#, 401)
      }
      return json(#"{"ok":true,"expiresAt":4102444800}"#, 200)
    default:
      return json(#"{"code":"not_found"}"#, 404)
    }
  }
}

final class WorkerClientTests: XCTestCase {
  private let baseURL = URL(string: "https://worker.example")!

  private func makeClient(
    attestor: FakeAttestor = FakeAttestor(),
    keyStore: InMemoryAttestKeyStore = InMemoryAttestKeyStore(),
    bypassToken: String? = nil,
    gateway: FakeGateway = FakeGateway()
  ) -> (WorkerClient, InMemoryAttestKeyStore) {
    let transport = FakeTransport { request in await gateway.respond(to: request) }
    let client = WorkerClient(baseURL: baseURL, attestor: attestor, transport: transport, keyStore: keyStore, bypassToken: bypassToken)
    return (client, keyStore)
  }

  func testFreshDeviceAttestsAndAuthenticates() async {
    let (client, keyStore) = makeClient()
    let state = await client.ensureSession()
    guard case .authenticated = state else { return XCTFail("expected authenticated, got \(state)") }
    XCTAssertEqual(keyStore.storedKeyId, "fake-key-id")
  }

  func testReturningDeviceAssertsWithStoredKey() async {
    let keyStore = InMemoryAttestKeyStore(keyId: "existing-key")
    let (client, _) = makeClient(keyStore: keyStore)
    let state = await client.ensureSession()
    guard case .authenticated = state else { return XCTFail("expected authenticated, got \(state)") }
  }

  func testUnknownKeyResetsAndReattests() async {
    let gateway = FakeGateway()
    await gateway.configure(unknownKeyOnce: true)
    let keyStore = InMemoryAttestKeyStore(keyId: "stale-key")
    let (client, _) = makeClient(keyStore: keyStore, gateway: gateway)
    let state = await client.ensureSession()
    guard case .authenticated = state else { return XCTFail("expected authenticated, got \(state)") }
    XCTAssertEqual(keyStore.storedKeyId, "fake-key-id", "stale key replaced by a fresh attest")
  }

  func testInvalidKeySelfHeals() async {
    let attestor = FakeAttestor(assertInvalidates: true)
    let keyStore = InMemoryAttestKeyStore(keyId: "invalid-key")
    let (client, _) = makeClient(attestor: attestor, keyStore: keyStore)
    let state = await client.ensureSession()
    guard case .authenticated = state else { return XCTFail("expected authenticated, got \(state)") }
    XCTAssertEqual(keyStore.storedKeyId, "fake-key-id")
  }

  func testUnsupportedWithoutBypassFails() async {
    let (client, _) = makeClient(attestor: FakeAttestor(supported: false))
    let state = await client.ensureSession()
    XCTAssertEqual(state, .failed(.attestUnsupported))
  }

  func testBypassAuthenticatesWhenAttestUnsupported() async {
    let (client, _) = makeClient(attestor: FakeAttestor(supported: false), bypassToken: "local-token")
    let state = await client.ensureSession()
    guard case .authenticated = state else { return XCTFail("expected authenticated, got \(state)") }
  }

  func testOfflineFailsAsNetwork() async {
    let transport = FakeTransport { _ in throw URLError(.notConnectedToInternet) }
    let client = WorkerClient(baseURL: baseURL, attestor: FakeAttestor(), transport: transport, keyStore: InMemoryAttestKeyStore())
    let state = await client.ensureSession()
    XCTAssertEqual(state, .failed(.network))
  }

  func testPingSucceedsAfterAuth() async {
    let (client, _) = makeClient()
    let result = await client.ping()
    XCTAssertTrue(result.ok)
  }

  func testPingReauthenticatesOnUnauthorized() async {
    let gateway = FakeGateway()
    await gateway.configure(pingUnauthorizedOnce: true)
    let (client, _) = makeClient(gateway: gateway)
    let result = await client.ping()
    XCTAssertTrue(result.ok, "a 401 ping should drop the token, re-auth, and succeed")
  }
}
```

- [ ] **Step 5: テストを走らせて緑を確認**

Run: `cd apple && swift test --package-path Packages/TripCheckKit --filter WorkerClientTests`
Expected: 全 pass。既存の AppCore テストも壊れていないこと(`swift test --package-path Packages/TripCheckKit` 全体でも確認)。

- [ ] **Step 6: コミット**

```bash
cd apple
git add Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/WorkerClient.swift Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/CannedWorkerClient.swift Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/WorkerAvailability.swift Packages/TripCheckKit/Tests/TripCheckAppCoreTests/WorkerClientTests.swift
git commit -m "The client walks attest, assert, re-entry and self-heal without ever touching an itinerary"
```

## Task 7: 診断画面・AppCopy・合成の根・entitlements/plist・UI テスト・手順書

**Files:**
- Create: `apple/TripCheck/Screens/Diagnostics/WorkerDiagnosticsScreen.swift`, `apple/TripCheck/Resources/TripCheck.entitlements`, `apple/docs/worker-auth-device-checklist.md`
- Modify: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Presentation/AppCopy.swift`(4 フィールドを 5 か所に追記), `apple/TripCheck/App/TripCheckApp.swift`, `apple/project.yml`, `apple/TripCheckUITests/PlannerFlowTests.swift`(1 テスト追記)

**Interfaces:**
- Consumes: Task 5/6 の `WorkerAuthenticating`, `WorkerAvailability`, `WorkerClientDescription`, `WorkerAuthState`, `WorkerPingResult`。既存 `AppCopy.for(_:)`, `Tokens`, `IconView`, `tcFont`, `.primaryAccent`。

- [ ] **Step 1: `AppCopy.swift` に 4 フィールドを追記(5 か所)**

(a) フィールド宣言 —— `intentApplied` の宣言直後(`public let intentApplied: String` の次行)に:

```swift

  // MARK: - Worker 認証の診断画面(spec 2026-08-25、-workerDiagnostics 時のみ)

  /// 診断画面の見出し。
  public let workerDiagnosticsTitle: String
  /// 疎通を確かめるボタン。
  public let workerDiagnosticsCheck: String
  /// 認証付き応答を受け取れたとき。
  public let workerDiagnosticsReachable: String
  /// 応答が無かったとき。
  public let workerDiagnosticsUnreachable: String
```

(b) init 引数 —— `intentApplied: String,` の直後に:

```swift
    workerDiagnosticsTitle: String,
    workerDiagnosticsCheck: String,
    workerDiagnosticsReachable: String,
    workerDiagnosticsUnreachable: String,
```

(c) init 代入 —— `self.intentApplied = intentApplied` の直後に:

```swift
    self.workerDiagnosticsTitle = workerDiagnosticsTitle
    self.workerDiagnosticsCheck = workerDiagnosticsCheck
    self.workerDiagnosticsReachable = workerDiagnosticsReachable
    self.workerDiagnosticsUnreachable = workerDiagnosticsUnreachable
```

(d) ja 表 —— `intentApplied: "読み取りました。内容を確認して構築へ進んでください。",` の直後に:

```swift
    workerDiagnosticsTitle: "接続診断",
    workerDiagnosticsCheck: "疎通を確認",
    workerDiagnosticsReachable: "認証付き応答を受信しました。",
    workerDiagnosticsUnreachable: "応答がありませんでした。",
```

(e) en 表 —— `intentApplied: "Details filled in. Review them, then build.",` の直後に:

```swift
    workerDiagnosticsTitle: "Connection check",
    workerDiagnosticsCheck: "Check connection",
    workerDiagnosticsReachable: "Authenticated response received.",
    workerDiagnosticsUnreachable: "No response.",
```

- [ ] **Step 2: AppCore テストが緑を確認(AppCopy パリティ)**

Run: `cd apple && swift test --package-path Packages/TripCheckKit`
Expected: 全 pass。特に AppCopy の ja/en を `BannedTerms` に通すテストが緑(新規 4 語が社内語を含まない)。

- [ ] **Step 3: `WorkerDiagnosticsScreen.swift` を作る**

英語ラベルは全て 12 文字未満の ASCII で、`Text("…")` の 12 文字ルールにも日本語ルールにも触れない(開発用の隠し画面なので、旅行者向けの文だけ `AppCopy` を通す)。

```swift
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
```

- [ ] **Step 4: `TripCheck.entitlements` を作る**

`apple/TripCheck/Resources/TripCheck.entitlements`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.developer.devicecheck.appattest-environment</key>
	<string>development</string>
</dict>
</plist>
```

- [ ] **Step 5: `project.yml` を配線(entitlements + plist キー)**

`targets.TripCheck.settings.base` に `CODE_SIGN_ENTITLEMENTS` を足す(既存の `PRODUCT_BUNDLE_IDENTIFIER` 等はそのまま):

```yaml
        CODE_SIGN_ENTITLEMENTS: TripCheck/Resources/TripCheck.entitlements
```

`targets.TripCheck.info.properties` に 2 キーを足す(`CFBundleURLTypes` ブロックの後ろ、`info.properties` の末尾):

```yaml
        TripCheckWorkerBaseURL: http://127.0.0.1:3000
        NSAppTransportSecurity:
          NSAllowsLocalNetworking: true
```

（`Info.plist` は XcodeGen が `info.properties` から再生成するので、物理ファイルは直接編集しない。`tools/verify-app.sh` が `xcodegen generate` で反映する。）

- [ ] **Step 6: `TripCheckApp.swift` を配線**

`init()` の中、`isUITesting` を決めた直後に診断フラグと Worker クライアントを組む。`_store` を作る `State(...)` の**後**に:

```swift
    let isWorkerDiagnostics = ProcessInfo.processInfo.arguments.contains("-workerDiagnostics")
    self.isWorkerDiagnostics = isWorkerDiagnostics
    let baseURLString = ProcessInfo.processInfo.environment["TRIPCHECK_WORKER_BASE_URL"]
      ?? (Bundle.main.object(forInfoDictionaryKey: "TripCheckWorkerBaseURL") as? String)
      ?? "http://127.0.0.1:3000"
    let baseURL = URL(string: baseURLString) ?? URL(string: "http://127.0.0.1:3000")!
    self.workerClient = WorkerAvailability.makeDefaultClient(
      uiTesting: isUITesting,
      baseURL: baseURL,
      bypassToken: ProcessInfo.processInfo.environment["TRIPCHECK_WORKER_BYPASS_TOKEN"]
    )
```

プロパティ宣言(`private let isUITesting: Bool` の近く)に:

```swift
  private let isWorkerDiagnostics: Bool
  private let workerClient: any WorkerAuthenticating
```

`body` の `WindowGroup { ... }` を、診断フラグで分岐させる(既存の `RootView()...` 連鎖はそのまま `else` 側に残す):

```swift
    WindowGroup {
      if isWorkerDiagnostics {
        WorkerDiagnosticsScreen(client: workerClient)
          .preferredColorScheme(.light)
      } else {
        RootView()
          .environment(store)
          .preferredColorScheme(.light)
          .transaction { transaction in
            guard isUITesting else { return }
            transaction.animation = nil
            transaction.disablesAnimations = true
          }
          .onOpenURL { url in
            guard let code = PlannerStore.shareCode(from: url) else { return }
            Task { await store.importShare(code: code) }
          }
      }
    }
```

- [ ] **Step 7: UI テストを 1 本足す**

`PlannerFlowTests.swift` の末尾(最後のテストの後、クラス閉じ括弧の前)に:

```swift
  /// `-workerDiagnostics` の隠し画面が出て、疎通ボタンが canned クライアントで成功する。
  @MainActor
  func testWorkerDiagnosticsPingsSuccessfully() {
    let app = XCUIApplication()
    app.launchArguments = ["-uiTesting", "-workerDiagnostics"]
    app.launch()

    XCTAssertTrue(app.otherElements["diag.screen"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.staticTexts["diag.state"].waitForExistence(timeout: 5))

    app.buttons["diag.check"].tap()
    XCTAssertTrue(app.staticTexts["diag.pingResult"].waitForExistence(timeout: 5))
  }
```

- [ ] **Step 8: 実機手順書を書く**

`apple/docs/worker-auth-device-checklist.md`:

```markdown
# Worker 認証 実機チェックリスト

Simulator は App Attest 非対応なので、本物のアテステーションはここでしか確かめられない。
自動テストは全てフェイク/バイパスで通っている。これは「本物の鍵と Apple の証明書で
1 度だけ門が開く」ことを人の手で確かめる手順。

## 1. Mac 側で Worker を起動

`.dev.vars` に 2 行足す(値はそのまま):

    TRIPCHECK_APP_IDS=T8L5BPC2XJ.com.muraoshoki.tripcheck
    TRIPCHECK_APP_ATTEST_ENVIRONMENTS=development

そして dev サーバを起動:

    pnpm dev

Mac の名前を確認しておく(例 `MacBook.local`):`scutil --get LocalHostName` に `.local` を足す。

## 2. iPhone を繋いで診断ビルドを流す

iPhone を USB で繋ぎ、Xcode の scheme の Run 引数に足す:

- Arguments Passed On Launch: `-workerDiagnostics`
- Environment Variables: `TRIPCHECK_WORKER_BASE_URL` = `http://<Mac名>.local:3000`

実機を選んで Run。

## 3. 診断画面で確かめる

- 「State」が `authenticated` になる(初回は attest → D1 に本物の keyId が載る)
- 「疎通を確認」を押して「認証付き応答を受信しました。」が出れば完了
- 2 回目以降の起動は assert 経路(counter が単調増加)で同じく通る

うまくいかないとき:App ID が `.dev.vars` の `TRIPCHECK_APP_IDS` と一致しているか、
Mac と iPhone が同じ Wi-Fi にいるか、`http://` を許すため Info.plist に
`NSAllowsLocalNetworking` が入っているか(project.yml 由来)を見る。
```

- [ ] **Step 9: 全体ビルド + テスト(実機なし)**

Run: `cd apple && ./tools/verify-app.sh`(xcodegen generate → build → test。無ければ `xcodegen generate` 後に `xcodebuild ... -destination 'platform=iOS Simulator,name=iPhone 16' test`)
Expected: ビルド成功・新規警告ゼロ、単体テスト(CopyBoundary 含む)+ UI テスト(既存 + 新規 `testWorkerDiagnosticsPingsSuccessfully`)が緑。CopyBoundary が緑 = 診断画面に日本語直書きなし。

- [ ] **Step 10: コミット**

```bash
cd apple
git add TripCheck/Screens/Diagnostics/WorkerDiagnosticsScreen.swift TripCheck/Resources/TripCheck.entitlements docs/worker-auth-device-checklist.md Packages/TripCheckKit/Sources/TripCheckAppCore/Presentation/AppCopy.swift TripCheck/App/TripCheckApp.swift project.yml TripCheckUITests/PlannerFlowTests.swift TripCheck/Resources/Info.plist
git commit -m "A hidden diagnostics screen proves the door opens, on the Simulator and on a real phone"
```

---

## Self-Review(計画者による確認)

- **spec 網羅**: §4 の 4 エンドポイント → Task 4 gateway。§5 検証手順 → Task 1〜4(検証済み参照)。§5.4 マニフェスト非追加 → Task 4 Step 5 で route-policy 網羅テスト緑を確認。§6 アプリ側 → Task 5〜7。§7 テスト戦略 → 各 Task のテスト。§8 手順書 → Task 7 Step 8。
- **型整合**: `WorkerAuthenticating`(Task 5)を `WorkerClient`/`CannedWorkerClient`(Task 6)が実装、`WorkerAvailability`(Task 6)が返し、`WorkerDiagnosticsScreen`/`TripCheckApp`(Task 7)が消費 —— 名前一致を確認。`AppAttestError.keyInvalid` は Task 5 定義、Task 6 で catch。
- **プレースホルダ無し**: 全 Step に実コードまたは実コマンド。
- **グローバル制約**: web の既存改変は `worker/index.ts` と `.env.example` のみ(Task 4)。Kit 不変(apple の新規は AppCore/アプリのみ)。トレーラ 2 行を全コミットに付与。
