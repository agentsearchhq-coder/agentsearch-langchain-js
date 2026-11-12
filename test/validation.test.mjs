import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentSearchTool, AgentSearchExtractTool, AgentSearchRenderTool, AgentSearchSearchAndReadTool, checkUrl, checkCount } from "../dist/index.js";

for (const k of ["AGENTSEARCH_WALLET_PRIVATE_KEY", "POCKET_PRIVATE_KEY", "AGENTSEARCH_MODE"]) delete process.env[k];

function counter() {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ results: [] }), { status: 200 }); };
  return { f, calls };
}

for (const q of ["", " ", "  \n\t "]) {
  test(`empty query ${JSON.stringify(q)} -> Error, no fetch`, async () => {
    const { f, calls } = counter();
    const out = await AgentSearchTool({ fetch: f }).invoke({ query: q });
    assert.match(out, /^Error: .*empty/);
    assert.equal(calls.length, 0);
  });
}

test("query trimmed, null max_results = default, clamping", async () => {
  const { f, calls } = counter();
  const t = AgentSearchTool({ fetch: f });
  await t.invoke({ query: "  lc  ", max_results: null });
  await t.invoke({ query: "x", max_results: 50 });
  await t.invoke({ query: "x", max_results: 0 });
  assert.deepEqual(calls.map((c) => c.body), [{ query: "lc" }, { query: "x", max_results: 5 }, { query: "x", max_results: 1 }]);
});

const BAD = ["", "example.com/page", "ftp://example.com/x", "javascript:alert(1)", "file:///etc/passwd", "https://user:pw@example.com/",
  "http://localhost:8080/", "http://127.0.0.1/", "http://10.0.0.5/", "http://192.168.1.1/", "http://169.254.169.254/latest",
  "http://[::1]/", "http://intranet/", "http://printer.local/", "http://svc.internal/", "https://exa mple.com/"];

for (const u of BAD) {
  test(`bad url ${JSON.stringify(u)} -> Error before wallet check`, async () => {
    for (const t of [AgentSearchExtractTool(), AgentSearchRenderTool()]) {
      const out = await t.invoke({ url: u });
      assert.match(out, /^Error: .*Nothing was sent/);
    }
  });
}

test("good urls pass", () => {
  for (const u of ["https://example.com", "http://example.com/a?b=1", "https://8.8.8.8/"]) assert.equal(checkUrl(u), u);
  assert.throws(() => checkUrl("example.com"), /https:\/\/example\.com/);
});

test("search_and_read empty query -> Error before wallet check", async () => {
  const out = await AgentSearchSearchAndReadTool().invoke({ query: "   " });
  assert.match(out, /^Error: .*empty/);
});

test("checkCount", () => {
  assert.equal(checkCount(undefined, "n"), undefined);
  assert.equal(checkCount(null, "n"), undefined);
  assert.equal(checkCount(9, "n"), 5);
  assert.throws(() => checkCount("x", "n"));
});

test("descriptions show direct prices", () => {
  assert.match(AgentSearchTool().description, /\$0\.008/);
  assert.match(AgentSearchExtractTool().description, /\$0\.004/);
  assert.doesNotMatch(AgentSearchExtractTool().description, /\$0\.007/);
});
