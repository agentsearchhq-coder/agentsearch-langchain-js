// 0.5.1: <2-char queries rejected client-side; relay 4xx errors say fix the input instead of retrying.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey } from "viem/accounts";
import { AgentSearchTool, AgentSearchNewsTool, AgentSearchSearchAndReadTool, checkQuery, InvalidInputError, MIN_QUERY_CHARS,
  RELAY_INPUT_ERROR_HINT, FREE_LIMIT_MESSAGE, freeSearch, resetSessionBudget } from "../dist/index.js";

const realFetch = globalThis.fetch;
beforeEach(() => {
  for (const k of ["AGENTSEARCH_WALLET_PRIVATE_KEY", "POCKET_PRIVATE_KEY", "AGENTSEARCH_MODE", "AGENTSEARCH_PAYMENT_ROUTE"]) delete process.env[k];
  resetSessionBudget();
  globalThis.fetch = realFetch;
});

function counter(status = 200, body = { results: [] }) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null }); return new Response(JSON.stringify(body), { status }); };
  return { f, calls };
}

test("MIN_QUERY_CHARS is 2; checkQuery trims then rejects 1 char", () => {
  assert.equal(MIN_QUERY_CHARS, 2);
  for (const q of ["a", " a ", "\tz\n", "?"]) {
    assert.throws(() => checkQuery(q), (e) => e instanceof InvalidInputError && /too short \(minimum 2 characters\)/.test(e.message) && /Don't retry it unchanged/.test(e.message) && /Nothing was sent or charged/.test(e.message));
  }
  assert.equal(checkQuery(" ab "), "ab");
  assert.equal(checkQuery("AI"), "AI");
});

for (const q of ["a", "  b  ", "1"]) {
  test(`free search ${JSON.stringify(q)} -> Error, no fetch`, async () => {
    const { f, calls } = counter();
    const out = await AgentSearchTool({ fetch: f }).invoke({ query: q });
    assert.match(out, /^Error: query .* is too short/);
    assert.equal(calls.length, 0);
  });
}

test("paid search, news and search_and_read reject 1-char query before any request or signing", async () => {
  process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = generatePrivateKey(); // throwaway, unfunded
  const { f, calls } = counter();
  globalThis.fetch = f;
  for (const out of [
    await AgentSearchTool({ mode: "paid", fetch: f }).invoke({ query: "x" }),
    await AgentSearchTool({ mode: "auto", fetch: f }).invoke({ query: " y " }),
    await AgentSearchNewsTool().invoke({ query: "n" }),
    await AgentSearchSearchAndReadTool().invoke({ query: "s" }),
  ]) assert.match(out, /^Error: query .* too short.*Nothing was sent or charged/);
  assert.equal(calls.length, 0);
});

test("no-wallet news/SAR: short query error comes first (input before wallet)", async () => {
  assert.match(await AgentSearchNewsTool().invoke({ query: "n" }), /too short/);
  assert.match(await AgentSearchSearchAndReadTool().invoke({ query: "s" }), /too short/);
});

test("2-char query is sent", async () => {
  const { f, calls } = counter();
  await AgentSearchTool({ fetch: f }).invoke({ query: "AI" });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { query: "AI" });
});

for (const status of [400, 404, 413, 422]) {
  test(`relay ${status} -> input-error hint`, async () => {
    const { f } = counter(status, { error: "bad query" });
    const out = await AgentSearchTool({ fetch: f }).invoke({ query: "ok query" });
    assert.match(out, new RegExp(`^Error: AgentSearch relay HTTP ${status}: .*bad query`));
    assert.ok(out.endsWith(RELAY_INPUT_ERROR_HINT), out);
    assert.match(out, /fix the query instead of retrying it unchanged/);
  });
}

for (const status of [408, 500, 502, 503]) {
  test(`relay ${status} -> no input-error hint`, async () => {
    const { f } = counter(status, { error: "upstream" });
    const out = await AgentSearchTool({ fetch: f }).invoke({ query: "ok query" });
    assert.match(out, new RegExp(`^Error: AgentSearch relay HTTP ${status}`));
    assert.doesNotMatch(out, /input error/);
  });
}

test("relay 429 keeps the daily-limit message, no input-error hint", async () => {
  const { f } = counter(429, { error: "limit" });
  const out = await AgentSearchTool({ fetch: f }).invoke({ query: "ok query" });
  assert.equal(out, `Error: ${FREE_LIMIT_MESSAGE}`);
  assert.doesNotMatch(out, /input error/);
});

test("freeSearch throws with status and hint on 400", async () => {
  const { f } = counter(400, { error: "query too short" });
  await assert.rejects(freeSearch("ok", undefined, f), (e) => e.status === 400 && e.message.endsWith(RELAY_INPUT_ERROR_HINT));
});
