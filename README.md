# @agentsearchhq/langchain

LangChain.js tools for [AgentSearch](https://agentsearchhq.com/?utm_source=agentsearchhq-langchain&utm_medium=package): live web search for agents. Free search needs no API key.

| Tool | Name | Cost |
|---|---|---|
| `AgentSearchTool` | `agentsearch_search` | **Free** by default (up to 25 searches/day per IP, subject to shared daily capacity; up to 5 results; no key). Paid search only when you opt in (`mode: "paid"` or `AGENTSEARCH_MODE=paid`), $0.008/call. |
| `AgentSearchExtractTool` | `agentsearch_extract` | **Free trial** with no wallet (5 calls/day per IP), then $0.004/call (USDC on Base via x402, paid directly to AgentSearch) |
| `AgentSearchRenderTool` | `agentsearch_render` | Headless browser for JS pages. **Free trial** with no wallet (3 calls/day per IP, no screenshots), then $0.010/call |
| `AgentSearchSearchAndReadTool` | `agentsearch_search_and_read` | Paid, search + top page text in one call, $0.009 (direct x402 only; charged only when at least one page returns text) |
| `AgentSearchNewsTool` | `agentsearch_news_search` | Paid, recent news articles with publish dates, $0.008 (direct x402 only; not charged when there are no results) |
| `AgentSearchScreenshotTool` | `agentsearch_screenshot` | Paid, PNG/JPEG page screenshot, $0.010 (direct x402 only). Image bytes go to the tool **artifact**, not the model text |

New in 0.5.0: news search, screenshots, search filters (freshness or date range, country, language, include/exclude domains) on paid search, news and search-and-read, and a no-wallet free trial for extract and render. See the [CHANGELOG](CHANGELOG.md).

## Install

```bash
npm install @agentsearchhq/langchain langchain @langchain/core
```

## Quick start (free, no key)

```ts
import { AgentSearchTool } from "@agentsearchhq/langchain";

const search = AgentSearchTool();
console.log(await search.invoke({ query: "latest LangChain.js release", max_results: 3 }));
// JSON string: {"query":...,"results":[{"title","url","content"}, ...]}
```

With an agent:

```ts
import { createAgent } from "langchain";
import { agentSearchTools } from "@agentsearchhq/langchain";

const agent = createAgent({
  model: "openai:gpt-4.1-mini",
  tools: agentSearchTools(),          // search (free) + extract/render (free trial) + paid search-and-read, news, screenshot
});
const res = await agent.invoke({ messages: [{ role: "user", content: "What changed in the latest LangChain.js release? Cite URLs." }] });
console.log(res.messages.at(-1)?.content);
```

## Search modes

The model only sees `agentsearch_search({ query, max_results })`; it can never choose paid search. The mode is a developer setting:

```ts
AgentSearchTool({ mode: "paid" });       // or agentSearchTools({ mode: "paid" })
```

- `free` (default): the free relay.
- `paid`: paid search ($0.008/call). Falls back to free with a console warning if no wallet key is set.
- `auto`: paid if a wallet key is set, otherwise free.

`AGENTSEARCH_MODE` (`free` / `paid` / `auto`) takes precedence over the `mode` option. A wallet key on its own never switches search to paid.

`agentsearch_extract` accepts `formats` (`markdown`, `text`, `html`, `links`), `max_chars` (up to 50000 on the direct API), `include_links` and `render_fallback`. `agentsearch_render` accepts the same `formats` plus `screenshot`, `wait_until`, `wait_for_selector` and `wait_ms` (on the direct route only `url` is sent; use `agentsearch_screenshot` for images). `agentsearch_news_search` takes `query`, `max_results` (1-10) and the filters below. `agentsearch_screenshot` takes `url`, `format` (`png`/`jpeg`), `full_page` and `viewport` (`{ width, height }`, e.g. 390x844 for mobile).

**Search filters** (paid search, news and search-and-read; the free tier ignores them): `freshness` (`day`, `week`, `month`, `year`) or `date_from`/`date_to` (YYYY-MM-DD), `country` (e.g. `us`), `language` (e.g. `en`, `pt-BR`), `include_domains` and `exclude_domains` (up to 5 each).

```ts
import { AgentSearchNewsTool, AgentSearchScreenshotTool } from "@agentsearchhq/langchain";

const news = await AgentSearchNewsTool().invoke({ query: "x402 payments", freshness: "week", country: "us" });

// Screenshot: invoke with a tool call to get a ToolMessage whose artifact holds the image.
const msg = await AgentSearchScreenshotTool().invoke({
  id: "1", name: "agentsearch_screenshot", type: "tool_call",
  args: { url: "https://agentsearchhq.com", viewport: { width: 390, height: 844 } },
});
const pngBase64 = msg.artifact?.screenshot?.base64;   // msg.content has metadata only
```

**Free trial (no wallet):** extract and render work without a wallet through the AgentSearch free relay: 5 extracts and 3 renders per day per IP (resets 00:00 UTC, subject to shared daily capacity, no screenshots). Results carry a `note` and a `free_trial` object with what's left today. Set `AGENTSEARCH_FREE_TRIAL=0` to turn it off. When it runs out, the error explains how to continue with a wallet.

## Paid mode (extract, render, search-and-read, news, screenshot, opt-in paid search)

Set `AGENTSEARCH_WALLET_PRIVATE_KEY` (or `POCKET_PRIVATE_KEY`, the name used by the Pocket Network portal tooling) to the private key of a **new wallet made only for this**, funded with a little USDC on Base (e.g. $1; no ETH needed). Since 0.3.0 calls are paid per request over x402 **directly to AgentSearch's own API** (`https://api.agentsearchhq.com`, USDC on Base, settled only on success): search $0.008, news $0.008, extract $0.004, render $0.010, screenshot $0.010, search-and-read $0.009 ([pricing](https://agentsearchhq.com/pricing?utm_source=agentsearchhq-langchain&utm_medium=package)). $1 covers about 250 extracts or 111 search-and-read calls. Prefer the Pocket Network Agentic Portal ($0.005 per call; search, extract and render only)? Set `AGENTSEARCH_PAYMENT_ROUTE=pocket`. On the direct route extract takes `url`, `max_chars` and `include_links`, and render takes only `url`; other options are dropped and listed in `payment.droppedFields`. Extract and render use the key directly; search stays free unless you opt in as above.

**Render fallback:** when extract returns thin content (under 200 characters, e.g. a JavaScript-heavy page), pass `render_fallback: true` to the extract call, or set `AGENTSEARCH_EXTRACT_RENDER_FALLBACK=1`, to retry automatically with render. That is a second call ($0.010 with a wallet, or one of the 3 free-trial renders without one); the result includes a `render_fallback` object.

| Env var | Default |
|---|---|
| `AGENTSEARCH_WALLET_PRIVATE_KEY` / `POCKET_PRIVATE_KEY` | unset (paid tools disabled; extract/render use the free trial) |
| `AGENTSEARCH_FREE_TRIAL` | on; `0` turns off the no-wallet extract/render trial |
| `AGENTSEARCH_MODE` | unset (`free`, `paid` or `auto`; overrides `mode`) |
| `AGENTSEARCH_MAX_TOTAL_ATOMIC` | `1000000` ($1.00 per process) |
| `AGENTSEARCH_PAYMENT_ROUTE` | `direct` (AgentSearch's x402 API); `pocket` = Pocket Network Agentic Portal at $0.005/call |
| `AGENTSEARCH_MAX_PER_CALL_ATOMIC` | `20000` on the direct route, `5000` on Pocket (can only be lowered) |
| `AGENTSEARCH_EXTRACT_RENDER_FALLBACK` | unset (`1` = extract retries thin pages with render) |
| `AGENTSEARCH_TIMEOUT_MS` | `30000` |
| `AGENTSEARCH_NO_CLIENT_TAG` | unset (`1` = don't send the anonymous `X-Agent-Client: @agentsearchhq/langchain/<version>` header) |

Spending caps are checked before anything is signed. The key is only used to sign and is not included in tool output or error messages. Paid results include a `payment` object (amount, transaction, explorer link).

Track spend in-process:

```ts
import { sessionSpentAtomic, resetSessionBudget } from "@agentsearchhq/langchain";

const spent: bigint = sessionSpentAtomic();   // USDC atomic units (6 decimals), e.g. 4000n = $0.004
console.log(`spent $${Number(spent) / 1e6}`);
resetSessionBudget();                          // reset the per-process counter
```

## Errors

Tools return `"Error: ..."` strings instead of throwing, so the agent can recover. A 429 from the free relay means the daily limit (up to 25 searches/day per IP, subject to shared daily capacity) was hit, and the message explains how to upgrade. Paid tools without a wallet return a message and make no request.

## Docs

- Agent guide: https://agentsearchhq.com/agents.md?utm_source=agentsearchhq-langchain&utm_medium=package
- Pricing: https://agentsearchhq.com/pricing?utm_source=agentsearchhq-langchain&utm_medium=package
- OpenAPI specs: https://agentsearchhq.com/specs/search-openapi.json?utm_source=agentsearchhq-langchain&utm_medium=package

MIT

Release notes: [CHANGELOG.md](CHANGELOG.md).

## Input checks (0.4.1)

Inputs are checked before any request is sent, so bad input never counts against the free daily limit and nothing is signed: an empty or whitespace-only `query`, or a URL that isn't a full public `http(s)` URL (no credentials, no localhost/private IPs/single-label hosts), returns an `Error: ...` string. `max_results: null` means the default and out-of-range counts are clamped to 1-5.

Docs: https://agentsearchhq.com/docs?utm_source=agentsearchhq-langchain&utm_medium=package · x402 API: https://agentsearchhq.com/docs/x402?utm_source=agentsearchhq-langchain&utm_medium=package
