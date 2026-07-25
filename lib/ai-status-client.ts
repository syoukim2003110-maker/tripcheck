/* Whether the server will accept Claude-backed requests right now. Unknown
 * (network error, old server) reports enabled so a live feature is never
 * hidden by a flaky status check; the feature's own not_configured error
 * still catches the truly paused case. */
export async function requestAiStatus(fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetcher("/api/ai-status", { headers: { Accept: "application/json" } });
    if (!response.ok) return true;
    const payload = await response.json().catch(() => null) as { enabled?: unknown } | null;
    return payload?.enabled !== false;
  } catch {
    return true;
  }
}
