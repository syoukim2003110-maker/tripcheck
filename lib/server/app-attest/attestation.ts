/**
 * App Attest attestation verification — the one-time registration proof.
 * Follows Apple's documented steps: certificate chain to the injected root,
 * nonce in the credential certificate, key identifier, and authenticator
 * data checks (App ID, zero counter, environment, credential id).
 */

import { base64ToBytes, bytesEqual, bytesToBase64Url, concatBytes, sha256, sha256Utf8 } from "./bytes.ts";
import { CborError, cborArray, cborBytes, cborMap, cborText, decodeCbor } from "./cbor.ts";
import { verifyCertificateChain } from "./certificate-chain.ts";
import { DerError, children, content, readNode } from "./der.ts";

export type AttestEnvironment = "development" | "production";

const NONCE_EXTENSION_OID = "1.2.840.113635.100.8.2";

const AAGUID_BY_ENVIRONMENT: Readonly<Record<AttestEnvironment, Uint8Array>> = Object.freeze({
  development: new TextEncoder().encode("appattestdevelop"),
  production: concatBytes(new TextEncoder().encode("appattest"), new Uint8Array(7)),
});

export interface AuthenticatorData {
  readonly rpIdHash: Uint8Array;
  readonly counter: number;
  readonly aaguid: Uint8Array | null;
  readonly credentialId: Uint8Array | null;
}

export function parseAuthenticatorData(bytes: Uint8Array): AuthenticatorData | null {
  if (bytes.length < 37) return null;
  const rpIdHash = bytes.slice(0, 32);
  const counter = new DataView(bytes.buffer, bytes.byteOffset + 33, 4).getUint32(0);
  if (bytes.length < 55) return { rpIdHash, counter, aaguid: null, credentialId: null };
  const aaguid = bytes.slice(37, 53);
  const credentialIdLength = (bytes[53] << 8) | bytes[54];
  if (bytes.length < 55 + credentialIdLength) return null;
  return { rpIdHash, counter, aaguid, credentialId: bytes.slice(55, 55 + credentialIdLength) };
}

export type AttestationVerdict =
  | Readonly<{ ok: true; keyId: string; publicKey: string; environment: AttestEnvironment; appId: string }>
  | Readonly<{ ok: false; code: "attestation_invalid" | "app_id_mismatch" | "environment_rejected" }>;

export async function verifyAttestation(input: {
  keyId: string;
  attestation: string;
  challenge: string;
  appIds: readonly string[];
  environments: readonly AttestEnvironment[];
  rootCertificate: Uint8Array;
  nowSeconds: number;
}): Promise<AttestationVerdict> {
  const invalid = { ok: false, code: "attestation_invalid" } as const;
  const attestationBytes = base64ToBytes(input.attestation);
  const keyIdBytes = base64ToBytes(input.keyId);
  if (!attestationBytes || !keyIdBytes || keyIdBytes.length !== 32) return invalid;

  let authData: Uint8Array;
  let leafDer: Uint8Array;
  let intermediateDer: Uint8Array;
  try {
    const object = cborMap(decodeCbor(attestationBytes), "attestation");
    if (cborText(object.get("fmt"), "fmt") !== "apple-appattest") return invalid;
    const statement = cborMap(object.get("attStmt"), "attStmt");
    const x5c = cborArray(statement.get("x5c"), "x5c");
    if (x5c.length < 2) return invalid;
    leafDer = cborBytes(x5c[0], "credCert");
    intermediateDer = cborBytes(x5c[1], "intermediate");
    authData = cborBytes(object.get("authData"), "authData");
  } catch (error) {
    if (error instanceof CborError) return invalid;
    throw error;
  }

  let leaf;
  try {
    leaf = await verifyCertificateChain({
      leaf: leafDer,
      intermediate: intermediateDer,
      root: input.rootCertificate,
      nowSeconds: input.nowSeconds,
    });
  } catch (error) {
    if (error instanceof DerError) return invalid;
    throw error;
  }

  const clientDataHash = await sha256(new TextEncoder().encode(input.challenge));
  const expectedNonce = await sha256(concatBytes(authData, clientDataHash));
  const nonceExtension = leaf.extensions.get(NONCE_EXTENSION_OID);
  if (!nonceExtension) return invalid;
  let certificateNonce: Uint8Array;
  try {
    certificateNonce = readNonceExtension(nonceExtension);
  } catch (error) {
    if (error instanceof DerError) return invalid;
    throw error;
  }
  if (!bytesEqual(certificateNonce, expectedNonce)) return invalid;

  const computedKeyId = await sha256(leaf.publicKeyPoint);
  if (!bytesEqual(computedKeyId, keyIdBytes)) return invalid;

  const parsed = parseAuthenticatorData(authData);
  if (!parsed || !parsed.aaguid || !parsed.credentialId) return invalid;

  let appId: string | null = null;
  for (const candidate of input.appIds) {
    if (bytesEqual(parsed.rpIdHash, await sha256Utf8(candidate))) {
      appId = candidate;
      break;
    }
  }
  if (!appId) return { ok: false, code: "app_id_mismatch" };

  if (parsed.counter !== 0) return invalid;

  let environment: AttestEnvironment | null = null;
  for (const candidate of input.environments) {
    if (bytesEqual(parsed.aaguid, AAGUID_BY_ENVIRONMENT[candidate])) {
      environment = candidate;
      break;
    }
  }
  if (!environment) return { ok: false, code: "environment_rejected" };

  if (!bytesEqual(parsed.credentialId, keyIdBytes)) return invalid;

  return {
    ok: true,
    keyId: bytesToBase64Url(keyIdBytes),
    publicKey: bytesToBase64Url(leaf.publicKeyPoint),
    environment,
    appId,
  };
}

/**
 * The nonce lives in an OCTET STRING wrapping SEQUENCE { [1] OCTET STRING }.
 */
function readNonceExtension(extensionValue: Uint8Array): Uint8Array {
  const sequence = readNode(extensionValue, 0);
  if (sequence.tag !== 0x30) throw new DerError("nonce extension is not a SEQUENCE");
  for (const child of children(extensionValue, sequence)) {
    if (child.tag !== 0xa1) continue;
    const [inner] = children(extensionValue, child);
    if (!inner || inner.tag !== 0x04) throw new DerError("nonce is not an OCTET STRING");
    const nonce = content(extensionValue, inner);
    if (nonce.length !== 32) throw new DerError("nonce must be 32 bytes");
    return nonce;
  }
  throw new DerError("nonce extension missing [1] element");
}
