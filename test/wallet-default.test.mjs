// 0.6.0: wallet => paid search by default; AGENTSEARCH_WALLET_FILE reuses an existing wallet (raw hex or AgentCash JSON).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { AgentSearchTool, resetSessionBudget, walletFilePath } from "../dist/index.js";

const API = "https://api.agentsearchhq.com";
const LEDGER = "0xC49B157887e51c21CB655f39CF65D6a4c2a4C337";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const realFetch = globalThis.fetch;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
let key, dir;

beforeEach(() => {
  for (const k of ["AGENTSEARCH_PAYMENT_ROUTE", "AGENTSEARCH_X402_DIRECT", "AGENTSEARCH_MAX_PER_CALL_ATOMIC", "AGENTSEARCH_MAX_TOTAL_ATOMIC",
    "POCKET_PRIVATE_KEY", "AGENTSEARCH_MODE", "AGENTSEARCH_WALLET_PRIVATE_KEY", "AGENTSEARCH_WALLET_FILE"]) delete process.env[k];
  key = generatePrivateKey(); // throwaway, unfunded
  dir = mkdtempSync(join(tmpdir(), "as-wallet-"));
  resetSessionBudget();
  globalThis.fetch = realFetch;
});

function mockApi() {
  const seen = { calls: [] };
  globalThis.fetch = async (url, init) => {
    const sig = new Headers(init.headers).get("payment-signature");
    seen.calls.push({ url: String(url), sig });
    if (String(url).startsWith("https://relay.agentsearchhq.com")) return new Response(JSON.stringify({ results: [] }), { status: 200 });
    if (!sig) {
      const t = { x402Version: 2, resource: { url: `${API}/x402/v1/search`, mimeType: "application/json" },
        accepts: [{ scheme: "exact", network: "eip155:8453", amount: "3000", asset: USDC, payTo: LEDGER, maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" } }] };
      return new Response(JSON.stringify(t), { status: 402, headers: { "PAYMENT-REQUIRED": b64(t) } });
    }
    seen.signed = JSON.parse(Buffer.from(sig, "base64").toString());
    return new Response(JSON.stringify({ results: [{ url: "https://e.com" }] }), { status: 200,
      headers: { "PAYMENT-RESPONSE": b64({ success: true, transaction: "0x" + "cd".repeat(32), network: "eip155:8453" }) } });
  };
  return seen;
}

test("no wallet: search uses the free relay, result says free", async () => {
  const seen = mockApi();
  const r = JSON.parse(await AgentSearchTool().invoke({ query: "qq" }));
  assert.equal(seen.calls.length, 1); assert.match(seen.calls[0].url, /relay\.agentsearchhq\.com/);
  assert.match(r.agentsearch_mode, /^free: .*no wallet configured/);
});

test("wallet key, default options: search signs $0.003 to AgentSearch on the direct API", async () => {
  process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = key;
  const seen = mockApi();
  const r = JSON.parse(await AgentSearchTool().invoke({ query: "qq" }));
  assert.equal(seen.calls[0].url, `${API}/x402/v1/search`);
  assert.equal(seen.signed.payload.authorization.value, "3000");
  assert.equal(seen.signed.payload.authorization.to.toLowerCase(), LEDGER.toLowerCase());
  assert.match(r.agentsearch_mode, /^paid: /);
});

test("AGENTSEARCH_MODE=free with a wallet: free relay, nothing signed", async () => {
  process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = key; process.env.AGENTSEARCH_MODE = "free";
  const seen = mockApi();
  await AgentSearchTool().invoke({ query: "qq" });
  assert.equal(seen.calls.length, 1); assert.equal(seen.calls[0].sig, null);
});

test("session cap still refuses before signing", async () => {
  process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = key; process.env.AGENTSEARCH_MAX_TOTAL_ATOMIC = "2999";
  const seen = mockApi();
  const r = await AgentSearchTool().invoke({ query: "qq" });
  assert.match(r, /^Error: /); assert.equal(seen.signed, undefined);
});

test("AGENTSEARCH_WALLET_FILE: hex file, AgentCash JSON and the agentcash shortcut", async () => {
  const hex = join(dir, "wallet.key"); writeFileSync(hex, key.slice(2));
  process.env.AGENTSEARCH_WALLET_FILE = hex;
  let seen = mockApi();
  await AgentSearchTool().invoke({ query: "qq" });
  assert.equal(seen.signed.payload.authorization.from.toLowerCase(), privateKeyToAccount(key).address.toLowerCase());
  const home = join(dir, "home"); mkdirSync(join(home, ".agentcash"), { recursive: true });
  writeFileSync(join(home, ".agentcash", "wallet.json"), JSON.stringify({ privateKey: key }));
  const oldHome = process.env.HOME; process.env.HOME = home;
  try {
    process.env.AGENTSEARCH_WALLET_FILE = "agentcash";
    assert.equal(walletFilePath(), join(home, ".agentcash", "wallet.json"));
    resetSessionBudget(); seen = mockApi();
    await AgentSearchTool().invoke({ query: "qq" });
    assert.equal(seen.signed.payload.authorization.value, "3000");
  } finally { process.env.HOME = oldHome; }
});

test("bad wallet file: clear error, nothing signed, contents not echoed", async () => {
  const bad = join(dir, "bad.json"); writeFileSync(bad, JSON.stringify({ secret: "do-not-echo-me" }));
  process.env.AGENTSEARCH_WALLET_FILE = bad;
  const seen = mockApi();
  const r = await AgentSearchTool().invoke({ query: "qq" });
  assert.match(r, /no "privateKey" field/); assert.doesNotMatch(r, /do-not-echo-me/); assert.equal(seen.signed, undefined);
});
