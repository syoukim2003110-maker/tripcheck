import { join, sep } from "node:path";

/*
 * What the static site (scripts/build-static.ts) is built from.
 *
 * Left out:
 * - app/api: server routes of the Workers deployment.
 * - app/classic: the old planner (/classic, /classic/ja). It showed Apple
 *   travel times and search results without an Apple map, which Apple's
 *   terms do not allow. Its source stays in the repository; it is not built
 *   and not linked from anywhere. api/deploy.php removes a copy left on the
 *   host by an earlier build (RETIRED_PAGES).
 * - The MapLibre map worker (/maplibre/): the booklet's map is Apple's now,
 *   and the static site ships no MapLibre. Its old folder is retired too.
 */

/** Page folders of earlier builds that must not stay on the host. Fixed names, no slashes. */
export const RETIRED_PAGES = ["classic", "maplibre"] as const;

const LEFT_OUT = [["app", "api"], ["app", "classic"]] as const;

/** Whether a file or folder under the repository root is copied into the static build. */
export function copiedIntoStaticBuild(root: string, source: string): boolean {
  return !LEFT_OUT.some((parts) => {
    const folder = join(root, ...parts);
    return source === folder || source.startsWith(folder + sep);
  });
}
