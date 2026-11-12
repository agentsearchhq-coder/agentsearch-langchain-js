// 0.3.0: direct x402 to AgentSearch's own API is the default paid route; Pocket is selectable.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey } from "viem/accounts";
import { AgentSearchTool, AgentSearchExtractTool, AgentSearchRenderTool, AgentSearchSearchAndReadTool, AgentSearchNewsTool, AgentSearchScreenshotTool, resetSessionBudget, paymentRoute } from "../dist/index.js";

const API = "https://api.agentsearchhq.com";
const LEDGER = "0xC49B157887e51c21CB655f39CF65D6a4c2a4C337";
const POCKET_PAYEE = "0xF732ea490c5766071785a2310523f7fA2CEbB829";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PRICES = { search: "8000", extract: "4000", render: "10000", search_and_read: "9000", news: "8000", screenshot: "10000" };
const realFetch = globalThis.fetch;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");

beforeEach(() => {
  for (const k of ["AGENTSEARCH_PAYMENT_ROUTE", "AGENTSEARCH_X402_DIRECT", "AGENTSEARCH_X402_DIRECT_URL", "AGENTSEARCH_MAX_PER_CALL_ATOMIC",
    "AGENTSEARCH_MAX_TOTAL_ATOMIC", "POCKET_PRIVATE_KEY", "AGENTSEARCH_MODE", "AGENTSEARCH_PORTAL_URL"]) delete process.env[k];
  process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = generatePrivateKey(); // throwaway, unfunded
  resetSessionBudget();
  globalThis.fetch = realFetch;
});

function mockApi(op, over = {}) {
  const seen = { calls: [] };
  globalThis.fetch = async (url, init) => {
    const h = new Headers(init.headers);
    const sig = h.get("payment-signature");
    seen.calls.push({ url: String(url), body: JSON.parse(init.body), sig });
    if (!sig) {
      const t = { x402Version: 2, resource: { url: `${API}/x402/v1/${op}`, mimeType: "application/json" },
        accepts: [{ scheme: "exact", network: "eip155:8453", amount: PRICES[op], asset: USDC, payTo: LEDGER, maxTimeoutSeconds: 300,
          extra: { name: "USD Coin", version: "2" }, ...over }] };
      return new Response(JSON.stringify(t), { status: 402, headers: { "PAYMENT-REQUIRED": b64(t) } });
    }
    seen.signed = JSON.parse(Buffer.from(sig, "base64").toString());
    return new Response(JSON.stringify({ markdown: "x".repeat(300), ok: op }), { status: 200,
      headers: { "PAYMENT-RESPONSE": b64({ success: true, transaction: "0x" + "cd".repeat(32), network: "eip155:8453" }) } });
  };
  return seen;
}

test("route: direct by default; pocket selectable; legacy switch; invalid throws", () => {
  assert.equal(paymentRoute(), "direct");
  process.env.AGENTSEARCH_PAYMENT_ROUTE = "pocket"; assert.equal(paymentRoute(), "pocket");
  process.env.AGENTSEARCH_PAYMENT_ROUTE = "portal"; assert.equal(paymentRoute(), "pocket");
  delete process.env.AGENTSEARCH_PAYMENT_ROUTE; process.env.AGENTSEARCH_X402_DIRECT = "0"; assert.equal(paymentRoute(), "pocket");
  process.env.AGENTSEARCH_PAYMENT_ROUTE = "direct"; assert.equal(paymentRoute(), "direct");
  process.env.AGENTSEARCH_PAYMENT_ROUTE = "bogus"; assert.throws(() => paymentRoute(), /must be 'direct'/);
});

for (const op of ["search", "extract", "render", "search_and_read"]) {
  test(`default ${op} signs ${PRICES[op]} to AgentSearch's payee on the direct API`, async () => {
    const seen = mockApi(op);
    const t = op === "search" ? AgentSearchTool({ mode: "paid" }) : op === "extract" ? AgentSearchExtractTool() : op === "search_and_read" ? AgentSearchSearchAndReadTool() : AgentSearchRenderTool();
    const arg = op === "search" ? { query: "q", max_results: 3 } : op === "search_and_read" ? { query: "q", num_results: 3 } : { url: "https://example.com", formats: ["markdown"] };
    const out = JSON.parse(await t.invoke(arg));
    assert.equal(seen.calls[0].url, `${API}/x402/v1/${op}`);
    const a = seen.signed.payload.authorization;
    assert.equal(a.to.toLowerCase(), LEDGER.toLowerCase());
    assert.equal(a.value, PRICES[op]);
    assert.equal(out.payment.payTo, LEDGER);
    assert.equal(out.payment.rail, "agentsearch-x402-direct");
    assert.equal(out.payment.settled, true);
    if (op === "extract" || op === "render") assert.deepEqual(Object.keys(seen.calls[1].body), ["url"]);
    if (op === "search_and_read") assert.equal(seen.calls[1].body.num_results, 3);
  });
}

test("pocket route goes to the portal", async () => {
  process.env.AGENTSEARCH_PAYMENT_ROUTE = "pocket";
  let url;
  globalThis.fetch = async (u) => { url = String(u); return new Response("stop", { status: 500 }); };
  await AgentSearchExtractTool().invoke({ url: "https://example.com" });
  assert.ok(url.startsWith("https://agent.pocket.network/v1/agentsearch-web-extract-v1"), url);
});

test("invalid route refuses with no network call", async () => {
  process.env.AGENTSEARCH_PAYMENT_ROUTE = "bogus";
  globalThis.fetch = async () => { throw new Error("no network expected"); };
  assert.match(await AgentSearchExtractTool().invoke({ url: "https://example.com" }), /AGENTSEARCH_PAYMENT_ROUTE must be/);
});

test("a per-call cap below the direct price gets a hint, nothing signed", async () => {
  process.env.AGENTSEARCH_MAX_PER_CALL_ATOMIC = "5000";
  const seen = mockApi("render");
  assert.match(await AgentSearchRenderTool().invoke({ url: "https://example.com" }), /AGENTSEARCH_PAYMENT_ROUTE=pocket/);
  assert.ok(seen.calls.every((c) => !c.sig));
});

for (const over of [{ payTo: POCKET_PAYEE }, { amount: "20001" }, { network: "eip155:84532" }, { asset: "0x" + "11".repeat(20) }]) {
  test(`refuses bad direct terms ${JSON.stringify(over)}`, async () => {
    const seen = mockApi("extract", over);
    assert.match(await AgentSearchExtractTool().invoke({ url: "https://example.com" }), /Nothing was signed/);
    assert.equal(seen.calls.length, 1);
  });
}

test("direct URL must be https", async () => {
  process.env.AGENTSEARCH_X402_DIRECT_URL = "http://evil.example";
  assert.match(await AgentSearchExtractTool().invoke({ url: "https://example.com" }), /must be https/);
});

const MOCK = process.env.AGENTSEARCH_TEST_DIRECT_MOCK;
test("e2e against local mock direct API", { skip: !MOCK }, async () => {
  process.env.AGENTSEARCH_X402_DIRECT_URL = MOCK;
  const s = JSON.parse(await AgentSearchTool({ mode: "paid" }).invoke({ query: "x402" }));
  const e = JSON.parse(await AgentSearchExtractTool().invoke({ url: "https://example.com" }));
  const r = JSON.parse(await AgentSearchRenderTool().invoke({ url: "https://example.com" }));
  assert.deepEqual([s, e, r].map((x) => x.payment.amountAtomic), ["8000", "4000", "10000"]);
  assert.ok([s, e, r].every((x) => x.payment.settled));
});

test("search_and_read is direct-only", async () => {
  process.env.AGENTSEARCH_PAYMENT_ROUTE = "pocket";
  globalThis.fetch = async () => { throw new Error("no network expected"); };
  assert.match(await AgentSearchSearchAndReadTool().invoke({ query: "q" }), /own x402 API/);
});

test("search_and_read with a $0.005 cap refuses and hints 20000", async () => {
  process.env.AGENTSEARCH_MAX_PER_CALL_ATOMIC = "5000";
  const seen = mockApi("search_and_read");
  assert.match(await AgentSearchSearchAndReadTool().invoke({ query: "q" }), /to 20000/);
  assert.ok(seen.calls.every((c) => !c.sig));
});

test("search_and_read with no wallet does not hit the free relay", async () => {
  delete process.env.AGENTSEARCH_WALLET_PRIVATE_KEY;
  delete process.env.POCKET_PRIVATE_KEY;
  globalThis.fetch = async () => { throw new Error("no network expected"); };
  assert.match(await AgentSearchSearchAndReadTool().invoke({ query: "q" }), /No wallet is configured|needs a wallet/i);
});

test("news signs $0.008 to /x402/v1/news with filters; max_results clamped to 10", async () => {
  const seen = mockApi("news");
  const out = JSON.parse(await AgentSearchNewsTool().invoke({ query: "base x402", max_results: 50, freshness: "week", country: "us", include_domains: ["coindesk.com"], exclude_domains: [] }));
  assert.equal(seen.calls[0].url, `${API}/x402/v1/news`);
  assert.deepEqual(seen.calls[1].body, { query: "base x402", freshness: "week", country: "us", include_domains: ["coindesk.com"], max_results: 10 });
  assert.equal(seen.signed.payload.authorization.value, "8000");
  assert.equal(out.payment.settled, true);
});

test("paid search and search_and_read forward filters; extract forwards max_chars (capped 50000) and include_links", async () => {
  let seen = mockApi("search");
  await AgentSearchTool({ mode: "paid" }).invoke({ query: "q", language: "en", date_from: "2026-11-01" });
  assert.deepEqual(seen.calls[1].body, { query: "q", language: "en", date_from: "2026-11-01" });
  resetSessionBudget(); seen = mockApi("search_and_read");
  await AgentSearchSearchAndReadTool().invoke({ query: "q", exclude_domains: ["pinterest.com"] });
  assert.deepEqual(seen.calls[1].body.exclude_domains, ["pinterest.com"]);
  resetSessionBudget(); seen = mockApi("extract");
  const out = JSON.parse(await AgentSearchExtractTool().invoke({ url: "https://example.com", max_chars: 90000, include_links: true, formats: ["markdown"] }));
  assert.deepEqual(seen.calls[1].body, { url: "https://example.com", max_chars: 50000, include_links: true });
  assert.deepEqual(out.payment.droppedFields, ["formats"]);
});

test("screenshot signs $0.010, keeps base64 out of the model text and in the artifact", async () => {
  const seen = { calls: [] };
  globalThis.fetch = async (url, init) => {
    const sig = new Headers(init.headers).get("payment-signature");
    seen.calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (!sig) {
      const t = { x402Version: 2, resource: { url: `${API}/x402/v1/screenshot` }, accepts: [{ scheme: "exact", network: "eip155:8453", amount: "10000", asset: USDC, payTo: LEDGER, maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" } }] };
      return new Response(JSON.stringify(t), { status: 402, headers: { "PAYMENT-REQUIRED": b64(t) } });
    }
    return new Response(JSON.stringify({ title: "Ex", screenshot: { format: "png", width: 390, height: 844, base64: "QUJD".repeat(100) } }), { status: 200,
      headers: { "PAYMENT-RESPONSE": b64({ success: true, transaction: "0x" + "ab".repeat(32), network: "eip155:8453" }) } });
  };
  const msg = await AgentSearchScreenshotTool().invoke({ id: "c1", name: "agentsearch_screenshot", type: "tool_call", args: { url: "https://example.com", viewport: { width: 390, height: 844 }, format: "png" } });
  assert.equal(seen.calls[0].url, `${API}/x402/v1/screenshot`);
  assert.deepEqual(seen.calls[1].body, { url: "https://example.com", format: "png", viewport: { width: 390, height: 844 } });
  assert.doesNotMatch(String(msg.content), /QUJD/);
  assert.match(String(msg.content), /omitted from text/);
  assert.equal(msg.artifact.screenshot.base64, "QUJD".repeat(100));
  assert.equal(msg.artifact.payment.amountAtomic, "10000");
});

for (const T of [AgentSearchNewsTool, AgentSearchScreenshotTool]) {
  test(`${T.name} is direct-only`, async () => {
    process.env.AGENTSEARCH_PAYMENT_ROUTE = "pocket";
    globalThis.fetch = async () => { throw new Error("no network expected"); };
    const r = T === AgentSearchNewsTool ? await T().invoke({ query: "q" }) : (await T().invoke({ id: "c", name: "agentsearch_screenshot", type: "tool_call", args: { url: "https://example.com" } })).content;
    assert.match(String(r), /own x402 API/);
  });
}
