import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * deploy/xserver/api/apple.php cannot be run by this suite (no PHP here),
 * so what must hold in it is checked in its source. These guard two things
 * that fail silently on the live host: a relay with no working quota file
 * running unlimited, and an outage being answered as "no route".
 */

const source = readFileSync(new URL("../deploy/xserver/api/apple.php", import.meta.url), "utf8");
const between = (start: string, end: string) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `apple.php no longer has ${start} … ${end}`);
  return source.slice(from, to);
};

test("the relay refuses when its quota file cannot be opened, locked or written", () => {
  const withState = between("function with_state(", "function base64url(");
  // No running the work on an empty state with a save that does nothing.
  assert.doesNotMatch(withState, /\$work\(\[\]/);
  assert.match(withState, /if \(\$handle === false\) respond\(503, \['code' => 'unavailable'\]\);/);
  assert.match(withState, /if \(!flock\(\$handle, LOCK_EX\)\) \{[^}]*respond\(503,/);
  assert.match(withState, /fwrite\([^;]*=== false \|\| !fflush\(\$handle\)\) \{[^}]*respond\(503,/);
});

test("no reply from Apple, or Apple refusing the relay, is an outage and never 'no answer'", () => {
  const eta = between("=== 'eta') {", "=== 'route') {");
  const route = source.slice(source.indexOf("=== 'route') {"));
  for (const [name, block] of [["eta", eta], ["route", route]] as const) {
    const outage = block.indexOf("if ($status === 0 || $status === 401 || $status === 403");
    const noAnswer = block.indexOf("respond(200,");
    assert.ok(outage >= 0, `${name}: the outage guard is missing`);
    assert.match(block.slice(outage, block.indexOf("\n", outage)), /respond\(502, \['code' => 'unavailable'\]\);$/);
    assert.ok(noAnswer > outage, `${name}: the outage guard must come before the null answer`);
  }
  // A line on the map has another source, so there Apple being down counts too.
  assert.match(route, /\$status === 403 \|\| \$status >= 500\) respond\(502,/);
});
