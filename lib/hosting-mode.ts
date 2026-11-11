/**
 * True in the static build for shared hosting, where this origin has no
 * `/api/` server routes at all (only the Apple relay). Callers use it to skip
 * a request that can only ever answer 404, not to change what the app claims.
 */
export function serverRoutesUnavailable() {
  return process.env.NEXT_PUBLIC_TRIPCHECK_STATIC_HOSTING === "1";
}

/** What a missing server route would have answered, without asking for it. */
export function notHostedResponse() {
  return Response.json({ code: "not_configured" }, { status: 503 });
}
