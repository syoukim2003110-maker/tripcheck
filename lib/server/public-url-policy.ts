export type HostAddressResolver = (hostname: string) => Promise<readonly string[]>;

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home",
  ".lan",
  ".corp",
  ".test",
  ".invalid",
  ".onion",
] as const;

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "instance-data.ec2.internal",
]);

const BLOCKED_IPV4_CIDRS = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["168.63.129.16", 32],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const;

function normalizeHostname(value: string) {
  return value.trim().toLocaleLowerCase("en-US")
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
}

function parseIpv4(value: string) {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const bytes = parts.map(Number);
  return bytes.every((byte) => byte >= 0 && byte <= 255) ? bytes : null;
}

function ipv4Number(bytes: readonly number[]) {
  return (((bytes[0] * 256) + bytes[1]) * 256 + bytes[2]) * 256 + bytes[3];
}

function ipv4InCidr(bytes: readonly number[], base: string, prefix: number) {
  const baseBytes = parseIpv4(base);
  if (!baseBytes) return false;
  const divisor = 2 ** (32 - prefix);
  return Math.floor(ipv4Number(bytes) / divisor) === Math.floor(ipv4Number(baseBytes) / divisor);
}

function parseIpv6(value: string) {
  let source = normalizeHostname(value);
  if (!source.includes(":") || source.includes("%")) return null;
  if (source.includes(".")) {
    const separator = source.lastIndexOf(":");
    if (separator < 0) return null;
    const ipv4 = parseIpv4(source.slice(separator + 1));
    if (!ipv4) return null;
    source = `${source.slice(0, separator)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }
  const halves = source.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [
    ...left.map((part) => Number.parseInt(part, 16)),
    ...Array.from({ length: Math.max(0, missing) }, () => 0),
    ...right.map((part) => Number.parseInt(part, 16)),
  ];
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const group of groups) bytes.push(group >> 8, group & 0xff);
  return bytes;
}

function bytesInPrefix(bytes: readonly number[], base: readonly number[], prefix: number) {
  const wholeBytes = Math.floor(prefix / 8);
  for (let index = 0; index < wholeBytes; index += 1) {
    if (bytes[index] !== base[index]) return false;
  }
  const remaining = prefix % 8;
  if (remaining === 0) return true;
  const mask = 0xff << (8 - remaining);
  return (bytes[wholeBytes] & mask) === (base[wholeBytes] & mask);
}

function ipv6InCidr(bytes: readonly number[], base: string, prefix: number) {
  const baseBytes = parseIpv6(base);
  return Boolean(baseBytes && bytesInPrefix(bytes, baseBytes, prefix));
}

export function isPublicIpAddress(value: string) {
  const normalized = normalizeHostname(value);
  const ipv4 = parseIpv4(normalized);
  if (ipv4) {
    return !BLOCKED_IPV4_CIDRS.some(([base, prefix]) => ipv4InCidr(ipv4, base, prefix));
  }
  const ipv6 = parseIpv6(normalized);
  if (!ipv6) return false;

  // IPv4-mapped IPv6 must inherit the embedded IPv4 policy.
  const mappedPrefix = Array.from({ length: 10 }, () => 0).concat([0xff, 0xff]);
  if (bytesInPrefix(ipv6, mappedPrefix, 96)) return isPublicIpAddress(ipv6.slice(12).join("."));

  // Only globally routable unicast is eligible. Exclude transition,
  // documentation, benchmarking and deprecated ranges inside 2000::/3.
  if (!ipv6InCidr(ipv6, "2000::", 3)) return false;
  return ![
    ["2001::", 32],
    ["2001:2::", 48],
    ["2001:10::", 28],
    ["2001:20::", 28],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["3ffe::", 16],
  ].some(([base, prefix]) => ipv6InCidr(ipv6, String(base), Number(prefix)));
}

function hostnameIsBlocked(hostname: string) {
  const normalized = normalizeHostname(hostname);
  if (!normalized || BLOCKED_HOSTS.has(normalized)) return true;
  if (!normalized.includes(".") && !parseIpv4(normalized) && !parseIpv6(normalized)) return true;
  return BLOCKED_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

/** Fast syntactic policy. Network resolution is enforced separately. */
export function parsePublicHttpsUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 500) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
  const hostname = normalizeHostname(url.hostname);
  if (hostnameIsBlocked(hostname)) return null;
  if ((parseIpv4(hostname) || parseIpv6(hostname)) && !isPublicIpAddress(hostname)) return null;
  return url;
}

type DnsJsonResponse = {
  Status?: unknown;
  Answer?: Array<{ type?: unknown; data?: unknown }>;
};

async function resolveDnsType(hostname: string, type: "A" | "AAAA", fetcher: typeof fetch) {
  const endpoint = new URL("https://cloudflare-dns.com/dns-query");
  endpoint.searchParams.set("name", hostname);
  endpoint.searchParams.set("type", type);
  const response = await fetcher(endpoint, {
    headers: { Accept: "application/dns-json" },
    redirect: "error",
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error("public_url_dns_unavailable");
  const payload = await response.json() as DnsJsonResponse;
  if (payload.Status !== 0 && payload.Status !== 3) throw new Error("public_url_dns_unavailable");
  const recordType = type === "A" ? 1 : 28;
  return (payload.Answer ?? [])
    .filter((answer) => answer.type === recordType && typeof answer.data === "string")
    .map((answer) => normalizeHostname(String(answer.data)));
}

/** Default Worker-compatible resolver; it never consults a local search domain. */
export async function resolvePublicHostAddresses(hostname: string, fetcher: typeof fetch = fetch) {
  const normalized = normalizeHostname(hostname);
  if (parseIpv4(normalized) || parseIpv6(normalized)) return [normalized];
  const [ipv4, ipv6] = await Promise.all([
    resolveDnsType(normalized, "A", fetcher),
    resolveDnsType(normalized, "AAAA", fetcher),
  ]);
  return [...new Set([...ipv4, ...ipv6])];
}

/**
 * Resolves immediately before each outbound request and fails closed if any
 * answer is local, private, link-local, metadata-adjacent, or non-IP.
 */
export async function assertPublicNetworkTarget(url: URL, resolver: HostAddressResolver) {
  const parsed = parsePublicHttpsUrl(url.toString());
  if (!parsed) throw new Error("public_url_blocked");
  const hostname = normalizeHostname(parsed.hostname);
  const literal = parseIpv4(hostname) || parseIpv6(hostname);
  const addresses = literal ? [hostname] : await resolver(hostname);
  if (addresses.length < 1 || addresses.some((address) => !isPublicIpAddress(address))) {
    throw new Error("public_url_blocked");
  }
  return parsed;
}
