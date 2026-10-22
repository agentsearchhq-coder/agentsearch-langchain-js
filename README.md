# @agentsearchhq/langchain

LangChain.js tools for [AgentSearch](https://agentsearchhq.com/?utm_source=agentsearchhq-langchain&utm_medium=package): live web search for agents. Free search needs no API key.

| Tool | Name | Cost |
|---|---|---|
| `AgentSearchTool` | `agentsearch_search` | **Free** by default (up to 25 searches/day per IP, subject to shared daily capacity; up to 5 results; no key). Paid search only when you opt in (`mode: "paid"` or `AGENTSEARCH_MODE=paid`), $0.005/call. |
| `AgentSearchExtractTool` | `agentsearch_extract` | $0.005/call (USDC on Base via x402) |
| `AgentSearchRenderTool` | `agentsearch_render` | Paid, headless browser for JS pages ([pricing](https://agentsearchhq.com/pricing?utm_source=agentsearchhq-langchain&utm_medium=package)) |

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
  tools: agentSearchTools(),          // search (free) + extract + render
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
- `paid`: paid search ($0.005/call). Falls back to free with a console warning if no wallet key is set.
- `auto`: paid if a wallet key is set, otherwise free.

`AGENTSEARCH_MODE` (`free` / `paid` / `auto`) takes precedence over the `mode` option. A wallet key on its own never switches search to paid.

`agentsearch_extract` accepts `formats` (`markdown`, `text`, `html`, `links`), `max_chars` and `render_fallback`. `agentsearch_render` accepts the same `formats` plus `screenshot`, `wait_until`, `wait_for_selector` and `wait_ms`.

## Paid mode (extract, render, opt-in paid search)

Set `AGENTSEARCH_WALLET_PRIVATE_KEY` (or `POCKET_PRIVATE_KEY`, the name used by the Pocket Network portal tooling) to the private key of a **new wallet made only for this**, funded with a little USDC on Base (e.g. $1; no ETH needed). Calls are paid per request over x402 through the Pocket Network Agentic Portal. Extract and render use the key directly; search stays free unless you opt in as above.

**Render fallback:** when extract returns thin content (under 200 characters, e.g. a JavaScript-heavy page), pass `render_fallback: true` to the extract call, or set `AGENTSEARCH_EXTRACT_RENDER_FALLBACK=1`, to retry automatically with render. That is a second paid call ([pricing](https://agentsearchhq.com/pricing?utm_source=agentsearchhq-langchain&utm_medium=package)); the result includes a `render_fallback` object.

| Env var | Default |
|---|---|
| `AGENTSEARCH_WALLET_PRIVATE_KEY` / `POCKET_PRIVATE_KEY` | unset (paid tools disabled) |
| `AGENTSEARCH_MODE` | unset (`free`, `paid` or `auto`; overrides `mode`) |
| `AGENTSEARCH_MAX_TOTAL_ATOMIC` | `1000000` ($1.00 per process) |
| `AGENTSEARCH_MAX_PER_CALL_ATOMIC` | `5000` ($0.005; can only be lowered) |
| `AGENTSEARCH_EXTRACT_RENDER_FALLBACK` | unset (`1` = extract retries thin pages with render) |
| `AGENTSEARCH_TIMEOUT_MS` | `30000` |
| `AGENTSEARCH_NO_CLIENT_TAG` | unset (`1` = don't send the anonymous `X-Agent-Client: @agentsearchhq/langchain/<version>` header) |

Spending caps are checked before anything is signed. The key is only used to sign and is not included in tool output or error messages. Paid results include a `payment` object (amount, transaction, explorer link).

Track spend in-process:

```ts
import { sessionSpentAtomic, resetSessionBudget } from "@agentsearchhq/langchain";

const spent: bigint = sessionSpentAtomic();   // USDC atomic units (6 decimals), e.g. 5000n = $0.005
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
