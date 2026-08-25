import assert from "node:assert/strict";
import test from "node:test";
import { decodeCbor, cborMap, cborBytes } from "../lib/server/app-attest/cbor.ts";
import { readNode, decodeOid, ecdsaSignatureToRaw, decodeTime } from "../lib/server/app-attest/der.ts";
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
  // SEQUENCE { INTEGER 0x01, INTEGER 0x00FF } => 30 07 02 01 01 02 02 00 FF
  const raw = ecdsaSignatureToRaw(Uint8Array.of(0x30, 0x07, 0x02, 0x01, 0x01, 0x02, 0x02, 0x00, 0xff), 32);
  assert.equal(raw.length, 64);
  assert.equal(raw[31], 0x01);
  assert.equal(raw[63], 0xff);
});

test("UTCTime and GeneralizedTime decode to the same epoch second", () => {
  const utc = Uint8Array.from([0x17, 0x0d, ...new TextEncoder().encode("250101000000Z")]);
  const gen = Uint8Array.from([0x18, 0x0f, ...new TextEncoder().encode("20250101000000Z")]);
  const expected = Date.parse("2025-01-01T00:00:00Z") / 1000;
  assert.equal(decodeTime(utc, readNode(utc, 0)), expected);
  assert.equal(decodeTime(gen, readNode(gen, 0)), expected);
});

test("CBOR decodes an array of unsigned integers, including a multi-byte length", () => {
  // [1, 258] => 82 01 19 01 02  (82=array(2), 01=uint 1, 19 0102 = uint 258 via 2-byte length)
  assert.deepEqual(decodeCbor(Uint8Array.of(0x82, 0x01, 0x19, 0x01, 0x02)), [1, 258]);
});
