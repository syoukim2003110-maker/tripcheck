/*
 * Second half of a deploy: after the build zip has been uploaded to the site
 * folder, ask the site to unpack it (api/deploy.php). The address, including
 * the deploy token, is read from dist-static/deploy-url.txt and never printed.
 */
import { readFileSync } from "node:fs";

let address: string;
try {
  address = readFileSync(new URL("../dist-static/deploy-url.txt", import.meta.url), "utf8").trim();
  if (!/^https:\/\/[^\s]+\/api\/deploy\.php\?key=[0-9a-f]{48}$/.test(address)) throw new Error("unexpected address");
} catch {
  console.error("dist-static/deploy-url.txt is missing. Run pnpm build:static first.");
  process.exit(1);
}

// `--from-folder <name>`: the build was extracted by the file manager into
// <site>/<name>/ and has not been moved up yet; run the copy inside it.
const folderIndex = process.argv.indexOf("--from-folder");
if (folderIndex >= 0) {
  const folder = process.argv[folderIndex + 1] ?? "";
  if (!/^tripcheck-site-[0-9a-f]{12}$/.test(folder)) {
    console.error("--from-folder expects a name like tripcheck-site-0123456789ab");
    process.exit(1);
  }
  address = address.replace("/api/deploy.php", `/${folder}/api/deploy.php`);
}

const response = await fetch(address, { headers: { "User-Agent": "TripCheck-deploy/0.1" }, signal: AbortSignal.timeout(120_000) });
const body = (await response.text()).trim();
console.log(`${new URL(address).origin} answered ${response.status}`);
console.log(body.length > 600 ? `${body.slice(0, 600)}…` : body);
process.exit(response.ok ? 0 : 1);
