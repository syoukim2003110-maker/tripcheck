/*
 * One reference rate per destination currency, in JPY, so "is CHF 40 for
 * lunch a lot?" has an answer before the card terminal asks its trick
 * question. Frankfurter (ECB-sourced, keyless) is the primary; the free
 * exchangerate-api endpoint is the fallback. Reference only — card networks
 * settle at their own rates.
 */

export type FxRate = {
  /** ISO 4217 code of the destination currency. */
  base: string;
  /** How many JPY one unit of `base` buys. */
  jpyPerUnit: number;
  /** Provider's own as-of date, YYYY-MM-DD. */
  asOf: string;
  source: "frankfurter" | "open-er-api";
};

export function parseFxBase(value: unknown): string | null {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) return null;
  if (value === "JPY") return null;
  return value;
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

async function fromFrankfurter(base: string, fetcher: typeof fetch): Promise<FxRate | null> {
  try {
    const response = await fetcher(`https://api.frankfurter.dev/v1/latest?base=${base}&symbols=JPY`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const body = await response.json().catch(() => null) as { date?: unknown; rates?: { JPY?: unknown } } | null;
    if (!body || typeof body.date !== "string" || !finitePositive(body.rates?.JPY)) return null;
    return { base, jpyPerUnit: body.rates.JPY, asOf: body.date, source: "frankfurter" };
  } catch {
    return null;
  }
}

async function fromOpenErApi(base: string, fetcher: typeof fetch): Promise<FxRate | null> {
  try {
    const response = await fetcher(`https://open.er-api.com/v6/latest/${base}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const body = await response.json().catch(() => null) as {
      result?: unknown;
      time_last_update_utc?: unknown;
      rates?: { JPY?: unknown };
    } | null;
    if (!body || body.result !== "success" || !finitePositive(body.rates?.JPY)) return null;
    const asOf = typeof body.time_last_update_utc === "string"
      ? new Date(body.time_last_update_utc).toISOString().slice(0, 10)
      : "";
    return { base, jpyPerUnit: body.rates.JPY, asOf, source: "open-er-api" };
  } catch {
    return null;
  }
}

/** Throws `fx_unavailable` only when both providers fail. */
export async function fetchJpyRate(base: string, fetcher: typeof fetch = fetch): Promise<FxRate> {
  const rate = await fromFrankfurter(base, fetcher) ?? await fromOpenErApi(base, fetcher);
  if (!rate) throw new Error("fx_unavailable");
  return rate;
}
