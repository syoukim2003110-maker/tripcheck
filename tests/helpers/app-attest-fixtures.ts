/**
 * Builds App Attest attestations and assertions the way a real device would,
 * but signed by a mini CA this test process mints. Everything is DER/CBOR by
 * hand so the gateway's own decoders are what get exercised — the fixture and
 * the verifier never share a code path.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  generateKeyPairSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";

function sha256(...parts: Uint8Array[]): Uint8Array {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return new Uint8Array(hash.digest());
}

// --- Tiny DER writer -------------------------------------------------------

function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  let value = length;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

function der(tag: number, content: Uint8Array): Uint8Array {
  return Uint8Array.from([tag, ...derLength(content.length), ...content]);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function oid(dotted: string): Uint8Array {
  const arcs = dotted.split(".").map(Number);
  const body = [arcs[0] * 40 + arcs[1]];
  for (const arc of arcs.slice(2)) {
    const chunk: number[] = [arc & 0x7f];
    let value = arc >> 7;
    while (value > 0) {
      chunk.unshift((value & 0x7f) | 0x80);
      value >>= 7;
    }
    body.push(...chunk);
  }
  return der(0x06, Uint8Array.from(body));
}

function integer(value: number): Uint8Array {
  return der(0x02, Uint8Array.from([value]));
}

function utcTime(text: string): Uint8Array {
  return der(0x17, new TextEncoder().encode(text));
}

function rdn(commonName: string): Uint8Array {
  const attribute = der(0x30, concat(oid("2.5.4.3"), der(0x0c, new TextEncoder().encode(commonName))));
  return der(0x30, der(0x31, attribute));
}

function spkiFor(publicKey: KeyObject): Uint8Array {
  return new Uint8Array(publicKey.export({ format: "der", type: "spki" }));
}

function ecdsaSign(tbs: Uint8Array, signer: KeyObject): Uint8Array {
  const sign = createSign("SHA256");
  sign.update(tbs);
  sign.end();
  return new Uint8Array(sign.sign({ key: signer, dsaEncoding: "der" }));
}

interface CertOptions {
  subject: string;
  issuer: string;
  subjectPublicKey: KeyObject;
  issuerPrivateKey: KeyObject;
  notBefore?: string;
  notAfter?: string;
  extensions?: Uint8Array;
}

function certificate(options: CertOptions): Uint8Array {
  const tbs = der(0x30, concat(
    der(0xa0, integer(2)),
    integer(1),
    der(0x30, oid("1.2.840.10045.4.3.2")),
    rdn(options.issuer),
    der(0x30, concat(
      utcTime(options.notBefore ?? "250101000000Z"),
      utcTime(options.notAfter ?? "350101000000Z"),
    )),
    rdn(options.subject),
    spkiFor(options.subjectPublicKey),
    ...(options.extensions ? [der(0xa3, der(0x30, options.extensions))] : []),
  ));
  const signature = ecdsaSign(tbs, options.issuerPrivateKey);
  return der(0x30, concat(
    tbs,
    der(0x30, oid("1.2.840.10045.4.3.2")),
    der(0x03, concat(Uint8Array.of(0), signature)),
  ));
}

function nonceExtension(nonce: Uint8Array): Uint8Array {
  const inner = der(0x30, der(0xa1, der(0x04, nonce)));
  return der(0x30, concat(oid("1.2.840.113635.100.8.2"), der(0x04, inner)));
}

// --- CBOR writer (uint, bytes, text, array, map) ---------------------------

function cborHead(major: number, length: number): Uint8Array {
  if (length < 24) return Uint8Array.of((major << 5) | length);
  if (length < 0x100) return Uint8Array.of((major << 5) | 24, length);
  if (length < 0x10000) return Uint8Array.of((major << 5) | 25, length >> 8, length & 0xff);
  return Uint8Array.of((major << 5) | 26, (length >>> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff);
}

function cborBytes(bytes: Uint8Array): Uint8Array {
  return concat(cborHead(2, bytes.length), bytes);
}

function cborText(text: string): Uint8Array {
  const bytes = new TextEncoder().encode(text);
  return concat(cborHead(3, bytes.length), bytes);
}

function cborArray(items: Uint8Array[]): Uint8Array {
  return concat(cborHead(4, items.length), ...items);
}

function cborMap(entries: [string, Uint8Array][]): Uint8Array {
  return concat(cborHead(5, entries.length), ...entries.flatMap(([key, value]) => [cborText(key), value]));
}

// --- Authenticator data ----------------------------------------------------

const ENV_AAGUID: Record<"development" | "production", Uint8Array> = {
  development: new TextEncoder().encode("appattestdevelop"),
  production: concat(new TextEncoder().encode("appattest"), new Uint8Array(7)),
};

function authenticatorData(options: {
  appId: string;
  counter: number;
  aaguid?: Uint8Array;
  credentialId?: Uint8Array;
}): Uint8Array {
  const rpIdHash = sha256(new TextEncoder().encode(options.appId));
  const counter = new Uint8Array(4);
  new DataView(counter.buffer).setUint32(0, options.counter);
  if (!options.aaguid || !options.credentialId) {
    return concat(rpIdHash, Uint8Array.of(0), counter);
  }
  const credentialIdLength = Uint8Array.of(options.credentialId.length >> 8, options.credentialId.length & 0xff);
  return concat(rpIdHash, Uint8Array.of(0), counter, options.aaguid, credentialIdLength, options.credentialId);
}

// --- Public fixture API ----------------------------------------------------

export function makeRootCa() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-384" });
  const der = certificate({
    subject: "Mini App Attest Root",
    issuer: "Mini App Attest Root",
    subjectPublicKey: publicKey,
    issuerPrivateKey: privateKey,
  });
  return { privateKey, publicKey, der };
}

export function makeIntermediate(root: ReturnType<typeof makeRootCa>) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-384" });
  const der = certificate({
    subject: "Mini App Attest CA",
    issuer: "Mini App Attest Root",
    subjectPublicKey: publicKey,
    issuerPrivateKey: root.privateKey,
  });
  return { privateKey, publicKey, der };
}

export interface DeviceKey {
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
  readonly point: Uint8Array;
  readonly keyId: Uint8Array;
}

export function makeDeviceKey(): DeviceKey {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const spki = spkiFor(publicKey);
  // The uncompressed point is the last 65 bytes of a P-256 SPKI.
  const point = spki.slice(spki.length - 65);
  return { privateKey, publicKey, point, keyId: sha256(point) };
}

export function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function buildAttestation(options: {
  root: ReturnType<typeof makeRootCa>;
  intermediate: ReturnType<typeof makeIntermediate>;
  device: DeviceKey;
  challenge: string;
  appId: string;
  environment?: "development" | "production";
  counter?: number;
  tamperNonce?: boolean;
}): string {
  const environment = options.environment ?? "development";
  const authData = authenticatorData({
    appId: options.appId,
    counter: options.counter ?? 0,
    aaguid: ENV_AAGUID[environment],
    credentialId: options.device.keyId,
  });
  const clientDataHash = sha256(new TextEncoder().encode(options.challenge));
  const nonce = sha256(authData, clientDataHash);
  const credCert = certificate({
    subject: "device",
    issuer: "Mini App Attest CA",
    subjectPublicKey: options.device.publicKey,
    issuerPrivateKey: options.intermediate.privateKey,
    extensions: nonceExtension(options.tamperNonce ? sha256(nonce) : nonce),
  });
  const attestation = cborMap([
    ["fmt", cborText("apple-appattest")],
    ["attStmt", cborMap([
      ["x5c", cborArray([cborBytes(credCert), cborBytes(options.intermediate.der)])],
      ["receipt", cborBytes(new Uint8Array(0))],
    ])],
    ["authData", cborBytes(authData)],
  ]);
  return base64(attestation);
}

export function buildAssertion(options: {
  device: DeviceKey;
  challenge: string;
  appId: string;
  counter: number;
}): string {
  const authenticatorDataBytes = authenticatorData({ appId: options.appId, counter: options.counter });
  const clientDataHash = sha256(new TextEncoder().encode(options.challenge));
  const nonce = sha256(authenticatorDataBytes, clientDataHash);
  const signature = ecdsaSign(nonce, options.device.privateKey);
  const assertion = cborMap([
    ["signature", cborBytes(signature)],
    ["authenticatorData", cborBytes(authenticatorDataBytes)],
  ]);
  return base64(assertion);
}

export function pointOf(publicKeyPem: string): Uint8Array {
  const spki = createPublicKey(publicKeyPem).export({ format: "der", type: "spki" }) as Buffer;
  return new Uint8Array(spki.slice(spki.length - 65));
}

export { createPrivateKey, randomBytes };
