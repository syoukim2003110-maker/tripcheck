/**
 * Paid Google place calls are a deployment-level, public opt-in. The default
 * is deliberately false so merely configuring a server key cannot spend it.
 */
export function paidPlaceResolutionEnabled() {
  return process.env.NEXT_PUBLIC_TRIPCHECK_PAID_PLACE_RESOLUTION_ENABLED === "true";
}
