/**
 * Minimal CBOR decoder — just the subset an App Attest attestation or
 * assertion actually uses: unsigned integers, byte strings, text strings,
 * arrays, and string-keyed maps, all definite-length. Anything outside that
 * subset is a malformed payload as far as this gateway is concerned, and
 * rejecting it loudly beats guessing.
 */

export type CborValue = number | string | Uint8Array | CborValue[] | CborMap;
export type CborMap = Map<string, CborValue>;

export class CborError extends Error {}

const MAX_DEPTH = 8;

export function decodeCbor(bytes: Uint8Array): CborValue {
  const reader = new CborReader(bytes);
  const value = reader.readValue(0);
  if (!reader.atEnd()) throw new CborError("trailing bytes after value");
  return value;
}

class CborReader {
  private offset = 0;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  atEnd(): boolean {
    return this.offset === this.bytes.length;
  }

  readValue(depth: number): CborValue {
    if (depth > MAX_DEPTH) throw new CborError("nesting too deep");
    const initial = this.readByte();
    const major = initial >> 5;
    const info = initial & 0x1f;
    switch (major) {
      case 0:
        return this.readLength(info);
      case 2:
        return this.readBytes(this.readLength(info));
      case 3:
        return new TextDecoder("utf-8", { fatal: true }).decode(this.readBytes(this.readLength(info)));
      case 4: {
        const count = this.readLength(info);
        const items: CborValue[] = [];
        for (let i = 0; i < count; i += 1) items.push(this.readValue(depth + 1));
        return items;
      }
      case 5: {
        const count = this.readLength(info);
        const map: CborMap = new Map();
        for (let i = 0; i < count; i += 1) {
          const key = this.readValue(depth + 1);
          if (typeof key !== "string") throw new CborError("non-text map key");
          if (map.has(key)) throw new CborError("duplicate map key");
          map.set(key, this.readValue(depth + 1));
        }
        return map;
      }
      default:
        throw new CborError(`unsupported major type ${major}`);
    }
  }

  private readByte(): number {
    if (this.offset >= this.bytes.length) throw new CborError("unexpected end of input");
    const value = this.bytes[this.offset];
    this.offset += 1;
    return value;
  }

  private readLength(info: number): number {
    if (info < 24) return info;
    if (info === 24) return this.readByte();
    if (info === 25) return (this.readByte() << 8) | this.readByte();
    if (info === 26) {
      let value = 0;
      for (let i = 0; i < 4; i += 1) value = value * 256 + this.readByte();
      return value;
    }
    // An 8-byte length cannot describe a payload this gateway would accept.
    throw new CborError("unsupported length encoding");
  }

  private readBytes(count: number): Uint8Array {
    if (this.offset + count > this.bytes.length) throw new CborError("length past end of input");
    const slice = this.bytes.slice(this.offset, this.offset + count);
    this.offset += count;
    return slice;
  }
}

export function cborMap(value: CborValue | undefined, label: string): CborMap {
  if (!(value instanceof Map)) throw new CborError(`${label} is not a map`);
  return value;
}

export function cborBytes(value: CborValue | undefined, label: string): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new CborError(`${label} is not a byte string`);
  return value;
}

export function cborText(value: CborValue | undefined, label: string): string {
  if (typeof value !== "string") throw new CborError(`${label} is not a text string`);
  return value;
}

export function cborArray(value: CborValue | undefined, label: string): CborValue[] {
  if (!Array.isArray(value)) throw new CborError(`${label} is not an array`);
  return value;
}
