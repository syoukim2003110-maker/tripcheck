/**
 * App Attest assertion verification — the steady-state re-entry proof.
 * A P-256 signature over SHA256(authenticatorData || clientDataHash) with
 * the key the attestation registered, plus a strictly increasing counter.
 */

import { base64ToBytes, bytesEqual, concatBytes, sha256, sha256Utf8 } from "./bytes.ts";
import { CborError, cborBytes, cborMap, decodeCbor } from "./cbor.ts";
import { DerError, ecdsaSignatureToRaw } from "./der.ts";
import { parseAuthenticatorData } from "./attestation.ts";

export type AssertionVerdict =
  | Readonly<{ ok: true; counter: number }>
  | Readonly<{ ok: false; code: "assertion_invalid" | "counter_regressed" | "app_id_mismatch" }>;

export async function verifyAssertion(input: {
  assertion: string;
  challenge: string;
  publicKeyPoint: Uint8Array;
  appId: string;
  storedCounter: number;
}): Promise<AssertionVerdict> {
  const invalid = { ok: false, code: "assertion_invalid" } as const;
  const assertionBytes = base64ToBytes(input.assertion);
  if (!assertionBytes) return invalid;

  let signatureDer: Uint8Array;
  let authenticatorData: Uint8Array;
  try {
    const object = cborMap(decodeCbor(assertionBytes), "assertion");
    signatureDer = cborBytes(object.get("signature"), "signature");
    authenticatorData = cborBytes(object.get("authenticatorData"), "authenticatorData");
  } catch (error) {
    if (error instanceof CborError) return invalid;
    throw error;
  }

  const clientDataHash = await sha256(new TextEncoder().encode(input.challenge));
  const nonce = await sha256(concatBytes(authenticatorData, clientDataHash));

  let rawSignature: Uint8Array;
  try {
    rawSignature = ecdsaSignatureToRaw(signatureDer, 32);
  } catch (error) {
    if (error instanceof DerError) return invalid;
    throw error;
  }

  let key: CryptoKey;
  try {
    key = await globalThis.crypto.subtle.importKey(
      "raw",
      input.publicKeyPoint,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
  } catch {
    return invalid;
  }
  const valid = await globalThis.crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, rawSignature, nonce);
  if (!valid) return invalid;

  const parsed = parseAuthenticatorData(authenticatorData);
  if (!parsed) return invalid;
  if (!bytesEqual(parsed.rpIdHash, await sha256Utf8(input.appId))) {
    return { ok: false, code: "app_id_mismatch" };
  }
  if (parsed.counter <= input.storedCounter) return { ok: false, code: "counter_regressed" };
  return { ok: true, counter: parsed.counter };
}
