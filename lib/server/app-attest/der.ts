/**
 * Minimal DER reader — enough X.690/X.509 to walk a certificate: read a
 * node's tag and content, iterate the children of a constructed node, and
 * decode OBJECT IDENTIFIER and Time values. It is a reader for the exact
 * shapes App Attest certificates use, not a general ASN.1 library.
 */

export class DerError extends Error {}

export interface DerNode {
  /** The full identifier octet (class, constructed bit, tag number). */
  readonly tag: number;
  readonly constructed: boolean;
  /** Offset of the identifier octet in the underlying buffer. */
  readonly start: number;
  /** Offset of the first content octet. */
  readonly contentStart: number;
  /** Offset just past the last content octet. */
  readonly end: number;
}

export function readNode(bytes: Uint8Array, offset: number): DerNode {
  if (offset + 2 > bytes.length) throw new DerError("truncated node header");
  const tag = bytes[offset];
  if ((tag & 0x1f) === 0x1f) throw new DerError("multi-byte tags unsupported");
  let cursor = offset + 1;
  let length = bytes[cursor];
  cursor += 1;
  if (length & 0x80) {
    const lengthBytes = length & 0x7f;
    if (lengthBytes === 0 || lengthBytes > 4) throw new DerError("unsupported length encoding");
    if (cursor + lengthBytes > bytes.length) throw new DerError("truncated length");
    length = 0;
    for (let i = 0; i < lengthBytes; i += 1) length = length * 256 + bytes[cursor + i];
    cursor += lengthBytes;
  }
  if (cursor + length > bytes.length) throw new DerError("content past end of input");
  return { tag, constructed: (tag & 0x20) !== 0, start: offset, contentStart: cursor, end: cursor + length };
}

export function children(bytes: Uint8Array, node: DerNode): DerNode[] {
  if (!node.constructed) throw new DerError("children of a primitive node");
  const out: DerNode[] = [];
  let cursor = node.contentStart;
  while (cursor < node.end) {
    const child = readNode(bytes, cursor);
    if (child.end > node.end) throw new DerError("child overruns parent");
    out.push(child);
    cursor = child.end;
  }
  return out;
}

export function content(bytes: Uint8Array, node: DerNode): Uint8Array {
  return bytes.slice(node.contentStart, node.end);
}

export function wholeNode(bytes: Uint8Array, node: DerNode): Uint8Array {
  return bytes.slice(node.start, node.end);
}

export function decodeOid(bytes: Uint8Array, node: DerNode): string {
  if (node.tag !== 0x06) throw new DerError("not an OBJECT IDENTIFIER");
  const octets = content(bytes, node);
  if (octets.length === 0) throw new DerError("empty OID");
  const parts: number[] = [Math.floor(octets[0] / 40), octets[0] % 40];
  let value = 0;
  for (let i = 1; i < octets.length; i += 1) {
    value = value * 128 + (octets[i] & 0x7f);
    if (value > Number.MAX_SAFE_INTEGER) throw new DerError("OID arc too large");
    if ((octets[i] & 0x80) === 0) {
      parts.push(value);
      value = 0;
    }
  }
  if (value !== 0) throw new DerError("truncated OID arc");
  return parts.join(".");
}

/** Decodes UTCTime or GeneralizedTime to epoch seconds. */
export function decodeTime(bytes: Uint8Array, node: DerNode): number {
  const text = new TextDecoder().decode(content(bytes, node));
  let iso: string;
  if (node.tag === 0x17) {
    if (!/^\d{12}Z$/.test(text)) throw new DerError(`unsupported UTCTime: ${text}`);
    const year = Number(text.slice(0, 2));
    const century = year >= 50 ? 1900 : 2000;
    iso = `${century + year}-${text.slice(2, 4)}-${text.slice(4, 6)}T${text.slice(6, 8)}:${text.slice(8, 10)}:${text.slice(10, 12)}Z`;
  } else if (node.tag === 0x18) {
    if (!/^\d{14}Z$/.test(text)) throw new DerError(`unsupported GeneralizedTime: ${text}`);
    iso = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T${text.slice(8, 10)}:${text.slice(10, 12)}:${text.slice(12, 14)}Z`;
  } else {
    throw new DerError("not a Time");
  }
  const milliseconds = Date.parse(iso);
  if (Number.isNaN(milliseconds)) throw new DerError(`invalid time: ${text}`);
  return Math.floor(milliseconds / 1000);
}

/**
 * Converts a DER-encoded ECDSA signature (SEQUENCE of two INTEGERs) to the
 * fixed-width r || s form Web Crypto verifies.
 */
export function ecdsaSignatureToRaw(der: Uint8Array, coordinateBytes: number): Uint8Array {
  const sequence = readNode(der, 0);
  if (sequence.tag !== 0x30 || sequence.end !== der.length) throw new DerError("signature is not a SEQUENCE");
  const integers = children(der, sequence);
  if (integers.length !== 2) throw new DerError("signature must hold two INTEGERs");
  const out = new Uint8Array(coordinateBytes * 2);
  writeFixedWidth(der, integers[0], out, 0, coordinateBytes);
  writeFixedWidth(der, integers[1], out, coordinateBytes, coordinateBytes);
  return out;
}

function writeFixedWidth(bytes: Uint8Array, node: DerNode, out: Uint8Array, at: number, size: number) {
  if (node.tag !== 0x02) throw new DerError("signature component is not an INTEGER");
  let digits = content(bytes, node);
  while (digits.length > size && digits[0] === 0) digits = digits.slice(1);
  if (digits.length > size) throw new DerError("signature component too large");
  out.set(digits, at + size - digits.length);
}
