import type { FxRate } from "./fx-rates.ts";

/** Reference rate for the essentials card; null on any failure (never gates). */
export async function requestJpyRate(base: string): Promise<FxRate | null> {
  if (!/^[A-Z]{3}$/.test(base) || base === "JPY") return null;
  let response: Response;
  try {
    response = await fetch(`/api/fx?base=${base}`);
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const body = await response.json().catch(() => null) as FxRate | null;
  if (!body || typeof body.jpyPerUnit !== "number" || !Number.isFinite(body.jpyPerUnit) || body.jpyPerUnit <= 0) return null;
  if (typeof body.asOf !== "string" || typeof body.base !== "string") return null;
  return body;
}
