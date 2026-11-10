import { test } from "node:test";
import assert from "node:assert/strict";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AgentSearchTool, AgentSearchExtractTool, AgentSearchRenderTool, agentSearchTools, FREE_LIMIT_MESSAGE } from "../dist/index.js";

for (const k of ["AGENTSEARCH_WALLET_PRIVATE_KEY", "POCKET_PRIVATE_KEY"]) delete process.env[k];

const fakeFetch = (status, body) => async (url, init) => {
  fakeFetch.last = { url, body: JSON.parse(init.body) };
  return new Response(JSON.stringify(body), { status });
};

/** Fake chat model: first turn calls the tool, second turn answers with the tool output. */
class FakeToolModel extends BaseChatModel {
  _llmType() { return "fake"; }
  bindTools(tools) { this.tools = tools; return this; }
  async _generate(messages) {
    const last = messages.at(-1);
    const msg = last instanceof ToolMessage
      ? new AIMessage(`Answer based on: ${last.content}`)
      : new AIMessage({ content: "", tool_calls: [{ type: "tool_call", id: "c1", name: "agentsearch_search", args: { query: last.content, max_results: 2 } }] });
    return { generations: [{ message: msg, text: String(msg.content) }] };
  }
}

async function runAgent(model, tools, question) {
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  const m = model.bindTools(tools);
  const msgs = [new HumanMessage(question)];
  for (let i = 0; i < 4; i++) {
    const ai = await m.invoke(msgs);
    msgs.push(ai);
    if (!ai.tool_calls?.length) return ai.content;
    for (const tc of ai.tool_calls) msgs.push(await byName[tc.name].invoke(tc));
  }
}

test("tool metadata and schemas", () => {
  const names = agentSearchTools().map((t) => t.name);
  assert.deepEqual(names, ["agentsearch_search", "agentsearch_extract", "agentsearch_render", "agentsearch_search_and_read"]);
});

test("free search via relay (mocked) and provider stripped", async () => {
  const t = AgentSearchTool({ fetch: fakeFetch(200, { query: "x", provider: "p", results: [{ title: "T", url: "https://a" }] }) });
  const r = JSON.parse(await t.invoke({ query: "x", max_results: 1 }));
  assert.equal(fakeFetch.last.url, "https://relay.agentsearchhq.com/v1/search");
  assert.deepEqual(fakeFetch.last.body, { query: "x", max_results: 1 });
  assert.equal(r.provider, undefined);
  assert.equal(r.results[0].title, "T");
});

test("429 -> friendly limit message", async () => {
  const t = AgentSearchTool({ fetch: fakeFetch(429, {}) });
  assert.equal(await t.invoke({ query: "x" }), `Error: ${FREE_LIMIT_MESSAGE}`);
});

test("paid tools refuse without a wallet", async () => {
  assert.match(await AgentSearchExtractTool().invoke({ url: "https://example.com" }), /paid.*No wallet/);
  assert.match(await AgentSearchRenderTool().invoke({ url: "https://example.com" }), /paid.*No wallet/);
});

test("bad wallet key is rejected without leaking it", async () => {
  process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = "nothex-secret";
  const r = await AgentSearchExtractTool().invoke({ url: "https://example.com" });
  delete process.env.AGENTSEARCH_WALLET_PRIVATE_KEY;
  assert.match(r, /not a private key/);
  assert.doesNotMatch(r, /nothex-secret/);
});

test("fake-model agent uses the tool (mocked fetch)", async () => {
  const tools = [AgentSearchTool({ fetch: fakeFetch(200, { results: [{ title: "Mocked", url: "https://m" }] }) })];
  const ans = await runAgent(new FakeToolModel({}), tools, "hello");
  assert.match(ans, /Mocked/);
});

test("LIVE: fake-model agent does one real free search", { skip: !process.env.AGENTSEARCH_LIVE }, async () => {
  const ans = await runAgent(new FakeToolModel({}), [AgentSearchTool()], "LangChain JS tools");
  assert.match(ans, /"url":"https?:\/\//);
});

test("wallet key alone never switches search to paid; schema hides mode", async () => {
  process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = "0x" + "11".repeat(32);
  try {
    const { resolveSearchMode } = await import("../dist/index.js");
    assert.equal(resolveSearchMode(), "free");
    assert.equal(resolveSearchMode("auto"), "paid");
    assert.equal(resolveSearchMode("paid"), "paid");
    const t = AgentSearchTool({ fetch: fakeFetch(200, { results: [] }) });
    await t.invoke({ query: "x" });
    assert.equal(fakeFetch.last.url, "https://relay.agentsearchhq.com/v1/search");
    process.env.AGENTSEARCH_MODE = "free";
    assert.equal(resolveSearchMode("paid"), "free");
  } finally {
    delete process.env.AGENTSEARCH_WALLET_PRIVATE_KEY; delete process.env.AGENTSEARCH_MODE;
  }
  const { resolveSearchMode } = await import("../dist/index.js");
  assert.equal(resolveSearchMode("paid"), "free"); // no key -> free fallback
  for (const t of agentSearchTools()) {
    const keys = Object.keys(t.schema.shape);
    assert.ok(!keys.includes("mode"), t.name);
  }
  assert.throws(() => AgentSearchTool({ mode: "bogus" }));
});

test("wording: per IP, no unlimited, no render price; extract formats enum", async () => {
  const fs = await import("node:fs");
  const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const { PAID_ONLY_MESSAGE } = await import("../dist/index.js");
  assert.match(FREE_LIMIT_MESSAGE, /per IP.*shared daily capacity/);
  for (const s of [FREE_LIMIT_MESSAGE, readme]) assert.doesNotMatch(s, /unlimited|per user/i);
  assert.doesNotMatch(PAID_ONLY_MESSAGE("agentsearch_render"), /\$/);
  const [, ex, rd] = agentSearchTools();
  assert.doesNotMatch(rd.description, /\$/);
  assert.doesNotMatch(ex.schema.shape.render_fallback.description, /\$/);
  assert.doesNotMatch(readme, /agentsearch_render`[^\n]*\$0/);
  assert.ok(ex.schema.safeParse({ url: "https://a.b", formats: ["markdown"] }).success);
  assert.ok(!ex.schema.safeParse({ url: "https://a.b", formats: ["pdf"] }).success);
});
