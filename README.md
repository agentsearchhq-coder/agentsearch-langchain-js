# @agentsearchhq/langchain

LangChain.js tools for [AgentSearch](https://agentsearchhq.com/?utm_source=agentsearchhq-langchain&utm_medium=package): live web search for agents.

| Tool | Name | Cost |
|---|---|---|
| `AgentSearchTool` | `agentsearch_search` | **Free** (25 searches/day per user, up to 5 results, no key). Paid & unlimited if a wallet is set. |
| `AgentSearchExtractTool` | `agentsearch_extract` | $0.005/call (USDC on Base via x402) |
| `AgentSearchRenderTool` | `agentsearch_render` | $0.005/call (headless browser for JS pages) |

## Install

```bash
npm install @agentsearchhq/langchain @langchain/core
```

## Quick start (free, no key)

```ts
import { AgentSearchTool } from "@agentsearchhq/langchain";

const search = AgentSearchTool();
console.log(await search.invoke({ query: "latest LangChain.js release", max_results: 3 }));
// JSON string: {"query":...,"results":[{"title","url","content"}, ...]}
```

With an agent (e.g. LangGraph):

```ts
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { agentSearchTools } from "@agentsearchhq/langchain";

const agent = createReactAgent({ llm, tools: agentSearchTools() });
```

## Paid mode (extract, render, unlimited search)

Set `AGENTSEARCH_WALLET_PRIVATE_KEY` to the private key of a **new wallet made only for this**, funded with a little USDC on Base (e.g. $1; no ETH needed). Calls are paid per request over x402 through the Pocket Network Agentic Portal. When a key is set, `AgentSearchTool` also switches to paid (force with `AgentSearchTool({ mode: "free" })`).

Spending caps (checked before anything is signed):

| Env var | Default |
|---|---|
| `AGENTSEARCH_MAX_TOTAL_ATOMIC` | `1000000` ($1.00 per process) |
| `AGENTSEARCH_MAX_PER_CALL_ATOMIC` | `5000` ($0.005; can only be lowered) |
| `AGENTSEARCH_TIMEOUT_MS` | `30000` |

The key is only used to sign and is never logged or returned. Paid results include a `payment` object (amount, transaction, explorer link).

## Errors

Tools return `"Error: ..."` strings instead of throwing, so the agent can recover. When the free daily limit is hit (HTTP 429) the message explains how to upgrade. Paid tools without a wallet return a message and make no request.

## Docs

- Agent guide: https://agentsearchhq.com/agents.md?utm_source=agentsearchhq-langchain&utm_medium=package
- OpenAPI specs: https://agentsearchhq.com/specs/search-openapi.json?utm_source=agentsearchhq-langchain&utm_medium=package

MIT
