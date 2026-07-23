import assert from "node:assert/strict";
import test from "node:test";
import {
  AnthropicDisabledError,
  anthropicRequestsEnabled,
  enabledAnthropicApiKey,
  postAnthropicMessages,
} from "../lib/anthropic-runtime.ts";

test("Claude requests require an exact explicit opt-in", () => {
  for (const value of [undefined, "", "false", "TRUE", "1"]) {
    const env = { ANTHROPIC_API_KEY: "saved-key", ANTHROPIC_REQUESTS_ENABLED: value };
    assert.equal(anthropicRequestsEnabled(env), false);
    assert.equal(enabledAnthropicApiKey(env), null);
  }
  assert.equal(enabledAnthropicApiKey({
    ANTHROPIC_API_KEY: "saved-key",
    ANTHROPIC_REQUESTS_ENABLED: "true",
  }), "saved-key");
});

test("the final network boundary blocks requests even when a key is supplied", async () => {
  const previous = process.env.ANTHROPIC_REQUESTS_ENABLED;
  delete process.env.ANTHROPIC_REQUESTS_ENABLED;
  let calls = 0;
  try {
    await assert.rejects(
      () => postAnthropicMessages("saved-key", { messages: [] }, {
        fetcher: (async () => {
          calls += 1;
          return Response.json({});
        }) as typeof fetch,
      }),
      AnthropicDisabledError,
    );
    assert.equal(calls, 0);
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_REQUESTS_ENABLED;
    else process.env.ANTHROPIC_REQUESTS_ENABLED = previous;
  }
});
