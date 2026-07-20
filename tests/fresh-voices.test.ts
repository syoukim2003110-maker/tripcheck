import assert from "node:assert/strict";
import test from "node:test";
import { buildFreshVoicesBody, fetchFreshVoices, pageAgeDays } from "../lib/fresh-voices.ts";

const request = { name: "浅草寺", area: "浅草", languageCode: "ja" as const };

test("caps one field check at two localized public-web searches", () => {
  const body = buildFreshVoicesBody(request);

  assert.equal(body.tools.length, 1);
  assert.equal(body.tools[0].type, "web_search_20250305");
  assert.equal(body.tools[0].max_uses, 2);
  assert.equal(body.tools[0].user_location.country, "JP");
  assert.match(body.messages[0].content, /浅草寺 \(浅草, Japan\)/);
  assert.match(body.system, /untrusted evidence/);
  assert.match(body.system, /Never infer/);
});

test("shows only cited search evidence and takes title and age from provider metadata", async () => {
  const result = await fetchFreshVoices(request, "anthropic-key", (async () => Response.json({
    content: [
      {
        type: "web_search_tool_result",
        tool_use_id: "tool_1",
        content: [
          { type: "web_search_result", url: "https://x.com/user/status/1", title: "浅草寺 混雑レポ", page_age: "3 days ago" },
          { type: "web_search_result", url: "https://blog.example.com/sensoji/", title: "浅草寺に行ってみた", page_age: "2 weeks ago" },
        ],
      },
      {
        type: "text",
        text: "週末は早い時間の再確認が必要です。",
        citations: [
          { type: "web_search_result_location", url: "https://x.com/user/status/1", title: "モデル側の題名", cited_text: "週末夕方は仲見世が早めに店じまいしていた。" },
          { type: "web_search_result_location", url: "https://invented.example.com/fake", title: "でっちあげ", cited_text: "検索結果にない引用。" },
          { type: "web_search_result_location", url: "https://blog.example.com/sensoji", title: "別タイトル", cited_text: "朝8時前は比較的静かだった。" },
        ],
      },
    ],
    usage: { server_tool_use: { web_search_requests: 2 } },
    stop_reason: "end_turn",
  })) as typeof fetch);

  assert.equal(result.provider, "anthropic_web_search");
  assert.equal(result.findings.length, 2);
  assert.equal(result.findings[0].url, "https://x.com/user/status/1");
  assert.equal(result.findings[0].title, "浅草寺 混雑レポ");
  assert.equal(result.findings[0].age, "3 days ago");
  assert.equal(result.findings[0].sourceKind, "social");
  assert.equal(result.findings[1].title, "浅草寺に行ってみた");
  assert.equal(result.searchCount, 2);
  assert.match(result.summary, /再確認/);
});

test("enforces the 90-day cutoff, deduplicates URLs and labels unknown dates", async () => {
  const result = await fetchFreshVoices(request, "anthropic-key", (async () => Response.json({
    content: [
      {
        type: "web_search_tool_result",
        tool_use_id: "tool_1",
        content: [
          { type: "web_search_result", url: "https://news.example.com/old", title: "古い記事", page_age: "January 1, 2020" },
          { type: "web_search_result", url: "https://note.com/visit", title: "更新日不明の体験記" },
        ],
      },
      {
        type: "text",
        text: "確認できる範囲だけを表示します。",
        citations: [
          { type: "web_search_result_location", url: "https://news.example.com/old", title: "古い記事", cited_text: "古い情報。" },
          { type: "web_search_result_location", url: "https://note.com/visit", title: "体験記", cited_text: "入口が分かりにくかった。" },
          { type: "web_search_result_location", url: "https://note.com/visit/", title: "重複", cited_text: "同じ情報。" },
        ],
      },
    ],
    stop_reason: "end_turn",
  })) as typeof fetch);

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].url, "https://note.com/visit");
  assert.equal(result.findings[0].isRecent, null);
  assert.equal(result.findings[0].age, null);
  assert.equal(pageAgeDays("2 weeks ago"), 14);
});

test("treats a web-search error inside an HTTP 200 response as unavailable", async () => {
  await assert.rejects(
    () => fetchFreshVoices(request, "anthropic-key", (async () => Response.json({
      content: [{
        type: "web_search_tool_result",
        tool_use_id: "tool_1",
        content: { type: "web_search_tool_result_error", error_code: "too_many_requests" },
      }],
      stop_reason: "end_turn",
    })) as typeof fetch),
    /fresh_voices_unavailable/,
  );
});

test("does not continue a paused turn beyond the two-search budget", async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return Response.json({
      content: [{
        type: "web_search_tool_result",
        tool_use_id: "tool_1",
        content: [{ type: "web_search_result", url: "https://x.com/user/status/2", title: "当日情報", page_age: "today", encrypted_content: "encrypted-source" }],
      }],
      stop_reason: "pause_turn",
    });
  }) as typeof fetch;

  await assert.rejects(() => fetchFreshVoices(request, "anthropic-key", fetcher), /fresh_voices_unavailable/);
  assert.equal(calls, 1);
});

test("fails when Claude does not execute a successful search or the provider is unavailable", async () => {
  await assert.rejects(
    () => fetchFreshVoices(request, "anthropic-key", (async () => Response.json({
      content: [{ type: "text", text: "No search was run." }],
      stop_reason: "end_turn",
    })) as typeof fetch),
    /fresh_voices_unavailable/,
  );
  await assert.rejects(
    () => fetchFreshVoices(request, "anthropic-key", (async () => new Response("overloaded", { status: 529 })) as typeof fetch),
    /fresh_voices_unavailable/,
  );
});
