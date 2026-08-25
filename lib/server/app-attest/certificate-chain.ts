/**
 * X.509 parsing and chain verification for App Attest certificates, on Web
 * Crypto alone so the same code runs in the Worker and under `node --test`.
 *
 * The trust anchor is injectable: production verifies against the Apple App
 * Attestation Root CA constant below, tests against a CA they minted
 * themselves. That seam is what makes the verifier testable without a
 * physical device.
 */

import { bytesEqual, base64ToBytes } from "./bytes.ts";
import {
  DerError,
  children,
  content,
  decodeOid,
  decodeTime,
  ecdsaSignatureToRaw,
  readNode,
  wholeNode,
  type DerNode,
} from "./der.ts";

/** https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem (valid to 2045-03-15). */
export const APPLE_APP_ATTEST_ROOT_CA_PEM = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----`;

export type EcCurve = "P-256" | "P-384";

export interface ParsedCertificate {
  readonly der: Uint8Array;
  /** The full TBSCertificate node, exactly the bytes the issuer signed. */
  readonly tbs: Uint8Array;
  readonly signatureAlgorithm: string;
  /** DER ECDSA signature (BIT STRING content, unused-bits octet removed). */
  readonly signature: Uint8Array;
  /** The full SubjectPublicKeyInfo node, importable as "spki". */
  readonly spki: Uint8Array;
  readonly curve: EcCurve;
  /** Uncompressed EC point (0x04 || X || Y). */
  readonly publicKeyPoint: Uint8Array;
  readonly issuer: Uint8Array;
  readonly subject: Uint8Array;
  readonly notBefore: number;
  readonly notAfter: number;
  /** extnID (dotted OID) to extnValue OCTET STRING content. */
  readonly extensions: ReadonlyMap<string, Uint8Array>;
}

const EC_PUBLIC_KEY_OID = "1.2.840.10045.2.1";
const CURVE_BY_OID: Readonly<Record<string, EcCurve>> = Object.freeze({
  "1.2.840.10045.3.1.7": "P-256",
  "1.3.132.0.34": "P-384",
});
const HASH_BY_SIGNATURE_OID: Readonly<Record<string, "SHA-256" | "SHA-384">> = Object.freeze({
  "1.2.840.10045.4.3.2": "SHA-256",
  "1.2.840.10045.4.3.3": "SHA-384",
});
const COORDINATE_BYTES: Readonly<Record<EcCurve, number>> = Object.freeze({ "P-256": 32, "P-384": 48 });
const POINT_BYTES: Readonly<Record<EcCurve, number>> = Object.freeze({ "P-256": 65, "P-384": 97 });

export function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----(?:BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
  const bytes = base64ToBytes(body);
  if (!bytes || bytes.length === 0) throw new DerError("invalid PEM");
  return bytes;
}

let cachedAppleRoot: Uint8Array | null = null;

export function appleAppAttestRootDer(): Uint8Array {
  cachedAppleRoot ??= pemToDer(APPLE_APP_ATTEST_ROOT_CA_PEM);
  return cachedAppleRoot;
}

export function parseCertificate(der: Uint8Array): ParsedCertificate {
  const certificate = readNode(der, 0);
  if (certificate.tag !== 0x30 || certificate.end !== der.length) throw new DerError("certificate is not a SEQUENCE");
  const [tbsNode, algorithmNode, signatureNode, ...extra] = children(der, certificate);
  if (!tbsNode || !algorithmNode || !signatureNode || extra.length > 0) throw new DerError("certificate must hold three elements");
  if (tbsNode.tag !== 0x30) throw new DerError("tbsCertificate is not a SEQUENCE");

  const algorithmChildren = children(der, algorithmNode);
  if (algorithmChildren.length === 0) throw new DerError("signatureAlgorithm is empty");
  const signatureAlgorithm = decodeOid(der, algorithmChildren[0]);

  if (signatureNode.tag !== 0x03) throw new DerError("signatureValue is not a BIT STRING");
  const signatureBits = content(der, signatureNode);
  if (signatureBits.length < 2 || signatureBits[0] !== 0) throw new DerError("signature has unused bits");
  const signature = signatureBits.slice(1);

  const tbsChildren = children(der, tbsNode);
  let index = 0;
  if (tbsChildren[index]?.tag === 0xa0) index += 1; // [0] EXPLICIT version
  index += 1; // serialNumber
  index += 1; // signature AlgorithmIdentifier
  const issuerNode = tbsChildren[index];
  index += 1;
  const validityNode = tbsChildren[index];
  index += 1;
  const subjectNode = tbsChildren[index];
  index += 1;
  const spkiNode = tbsChildren[index];
  index += 1;
  if (!issuerNode || !validityNode || !subjectNode || !spkiNode) throw new DerError("tbsCertificate is missing fields");
  if (issuerNode.tag !== 0x30 || validityNode.tag !== 0x30 || subjectNode.tag !== 0x30 || spkiNode.tag !== 0x30) {
    throw new DerError("tbsCertificate fields out of order");
  }

  const validityChildren = children(der, validityNode);
  if (validityChildren.length !== 2) throw new DerError("validity must hold two times");
  const notBefore = decodeTime(der, validityChildren[0]);
  const notAfter = decodeTime(der, validityChildren[1]);

  const spkiChildren = children(der, spkiNode);
  if (spkiChildren.length !== 2) throw new DerError("subjectPublicKeyInfo must hold two elements");
  const spkiAlgorithm = children(der, spkiChildren[0]);
  if (spkiAlgorithm.length !== 2 || decodeOid(der, spkiAlgorithm[0]) !== EC_PUBLIC_KEY_OID) {
    throw new DerError("public key is not an EC key");
  }
  const curve = CURVE_BY_OID[decodeOid(der, spkiAlgorithm[1])];
  if (!curve) throw new DerError("unsupported EC curve");
  if (spkiChildren[1].tag !== 0x03) throw new DerError("public key is not a BIT STRING");
  const pointBits = content(der, spkiChildren[1]);
  if (pointBits.length !== POINT_BYTES[curve] + 1 || pointBits[0] !== 0 || pointBits[1] !== 0x04) {
    throw new DerError("public key is not an uncompressed point");
  }
  const publicKeyPoint = pointBits.slice(1);

  const extensions = new Map<string, Uint8Array>();
  for (let cursor = index; cursor < tbsChildren.length; cursor += 1) {
    if (tbsChildren[cursor].tag !== 0xa3) continue;
    const [extensionList] = children(der, tbsChildren[cursor]);
    if (!extensionList || extensionList.tag !== 0x30) throw new DerError("extensions is not a SEQUENCE");
    for (const extensionNode of children(der, extensionList)) {
      const parts = children(der, extensionNode);
      if (parts.length < 2) throw new DerError("extension too short");
      const oid = decodeOid(der, parts[0]);
      const valueNode = parts[parts.length - 1];
      if (valueNode.tag !== 0x04) throw new DerError("extension value is not an OCTET STRING");
      extensions.set(oid, content(der, valueNode));
    }
  }

  return {
    der: der.slice(),
    tbs: wholeNode(der, tbsNode),
    signatureAlgorithm,
    signature,
    spki: wholeNode(der, spkiNode),
    curve,
    publicKeyPoint,
    issuer: wholeNode(der, issuerNode),
    subject: wholeNode(der, subjectNode),
    notBefore,
    notAfter,
    extensions,
  };
}

async function verifyLink(subject: ParsedCertificate, issuer: ParsedCertificate, nowSeconds: number) {
  if (nowSeconds < subject.notBefore || nowSeconds > subject.notAfter) {
    throw new DerError("certificate outside its validity window");
  }
  if (!bytesEqual(subject.issuer, issuer.subject)) throw new DerError("issuer name does not chain");
  const hash = HASH_BY_SIGNATURE_OID[subject.signatureAlgorithm];
  if (!hash) throw new DerError("unsupported signature algorithm");
  const key = await globalThis.crypto.subtle.importKey(
    "spki",
    issuer.spki,
    { name: "ECDSA", namedCurve: issuer.curve },
    false,
    ["verify"],
  );
  const raw = ecdsaSignatureToRaw(subject.signature, COORDINATE_BYTES[issuer.curve]);
  const valid = await globalThis.crypto.subtle.verify({ name: "ECDSA", hash }, key, raw, subject.tbs);
  if (!valid) throw new DerError("signature does not verify");
}

/**
 * Verifies leaf <- intermediate <- root and returns the parsed leaf. The root
 * is the injected trust anchor; only its validity window is checked.
 */
export async function verifyCertificateChain(input: {
  leaf: Uint8Array;
  intermediate: Uint8Array;
  root: Uint8Array;
  nowSeconds: number;
}): Promise<ParsedCertificate> {
  const leaf = parseCertificate(input.leaf);
  const intermediate = parseCertificate(input.intermediate);
  const root = parseCertificate(input.root);
  if (input.nowSeconds < root.notBefore || input.nowSeconds > root.notAfter) {
    throw new DerError("root certificate outside its validity window");
  }
  await verifyLink(leaf, intermediate, input.nowSeconds);
  await verifyLink(intermediate, root, input.nowSeconds);
  return leaf;
}
