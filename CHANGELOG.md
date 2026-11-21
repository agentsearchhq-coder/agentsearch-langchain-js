# Changelog

## 0.6.2 (2026-11-21)

- News, Search + Read and Screenshot use the free relay by default (10 free calls per IP in total each). Paid x402 only when a wallet is set and AGENTSEARCH_MODE=paid (or mode: "paid").

## 0.6.1 (2026-11-20)
- Free search wording: the free relay now allows **25 free searches per IP in total** (a lifetime allowance since 2026-11-19, not per day), then pay per call via x402 on Base ($0.003 per search at https://api.agentsearchhq.com; wallet setup https://agentsearchhq.com/wallet-setup). The search tool description, the free-limit (HTTP 429) message, `searchModeLabel()` and the README no longer say "25 searches/day per IP", "resets daily" or "daily limit". The extract/render free trial is unchanged (5 extract and 3 render calls per day per IP). No behavior change.

## 0.6.0 (2026-11-19)
- **With a wallet, search pays by default.** The search mode now defaults to `auto`: when a wallet is configured, `agentsearch_search` pays $0.003 per call over x402 to AgentSearch's own API ($0.005 with `AGENTSEARCH_PAYMENT_ROUTE=pocket`). With no wallet it uses the free relay exactly as before. `mode: "free"` or `AGENTSEARCH_MODE=free` is the opt-out. Spend caps are unchanged (per call and `AGENTSEARCH_MAX_TOTAL_ATOMIC`, default $1.00).
- **Reuse an existing wallet:** `AGENTSEARCH_WALLET_FILE` points at a file holding a 64-hex key or JSON with `privateKey` (`agentcash` = AgentCash's `~/.agentcash/wallet.json`). Read only when signing; never logged. New exports: `walletFilePath`, `walletSource`, `WALLET_FILE_ENV_VAR`.
- **Mode is visible:** search results carry `agentsearch_mode`; `searchModeLabel()` is exported; one stderr line when a tool is created with paid search.
- README: search price in the tool table fixed to $0.003 (was $0.005).

## 0.5.4 (2026-11-18)
- Fix HTTP 400s from the free relay. `freeSearch()` (also used when you pass it to a framework as a plain function, e.g. `RunnableLambda`/`tool(freeSearch)`) now unwraps a whole tool-input object passed as `query` (`{query, max_results}`), ignores a non-count object in the `maxResults` slot (such as the RunnableConfig a framework passes as the 2nd argument), accepts a numeric string or `{max_results: n}` for the count, clamps it to 1-5, and throws a clear `InvalidInputError` before any request when the query is empty, missing or not a string/number. Nothing is sent or charged in that case.
- `checkQuery` / `checkCount` apply the same unwrapping (`coerceCount` is new: never throws). The `X-Agent-Client` tag now reports the real package version.

## 0.5.3 (2026-11-16)
- Docs only: README tool table: news $0.003 and screenshot $0.004 (were still $0.005). Live direct prices: search and news $0.003, extract $0.002, render $0.005, screenshot $0.004, search_and_read $0.005; Pocket route unchanged at $0.005. No code or behavior change.

## 0.5.2 (2026-11-15)
- Direct x402 list prices now match the live API (approved 2026-11-15): search and news $0.003, extract $0.002, render $0.005, screenshot $0.004, search_and_read $0.005. Runtime price constants, tool text, docs and tests updated. Pocket route remains $0.005. The per-call ceiling stays $0.020.

## 0.5.1 (2026-11-14)
- Queries shorter than 2 characters (after trimming) on search, news and search-and-read now return an `Error: ...` string with no HTTP call and nothing signed, so they never count against the free relay's per-IP limits. The free relay rejects them with HTTP 400 anyway. `MIN_QUERY_CHARS` is exported.
- Free-relay 4xx errors (except 408 and 429) now tell the agent to fix the input instead of retrying it unchanged (`RELAY_INPUT_ERROR_HINT`). Matches `@agentsearchhq/agentsearch-mcp` 1.8.1, `langchain-agentsearch` 0.7.1 and the 0.5.1 CrewAI / LlamaIndex / OpenAI Agents packages.

## 0.5.0 (2026-11-12)
- **News search.** New `AgentSearchNewsTool` (`agentsearch_news_search`): recent articles with title, URL, snippet, domain and publish date, $0.008 per call on `https://api.agentsearchhq.com/x402/v1/news` (not charged when there are no results). `max_results` 1-10.
- **Screenshots.** New `AgentSearchScreenshotTool` (`agentsearch_screenshot`): PNG or JPEG of the viewport or full page (up to 4000 px tall), optional `viewport` (e.g. 390x844), $0.010 per call. Uses `responseFormat: "content_and_artifact"`: the model text has metadata only and the base64 image is in the ToolMessage `artifact`.
- **Search filters** on paid search, news and search-and-read: `freshness` or `date_from`/`date_to`, `country`, `language`, `include_domains`, `exclude_domains`.
- **Free trial without a wallet** for extract (5/day per IP) and render (3/day per IP, no screenshots) through the AgentSearch free relay. Previously these returned a "needs a wallet" error. `AGENTSEARCH_FREE_TRIAL=0` restores the old behavior.
- Extract on the direct route now forwards `max_chars` (capped at 50000) and the new `include_links`; before 0.5.0 they were dropped.
- Prices updated to match the direct API: extract $0.004 (was $0.007), search-and-read $0.009 (was $0.015). Search $0.008 and render $0.010 unchanged. News, screenshot and search-and-read are direct-only.
- `agentSearchTools()` now returns all six tools.

## 0.4.1 (2026-11-10)
- Input checks before any request: an empty/whitespace-only `query`, or a missing/invalid URL (not http/https, no host, embedded credentials, localhost, private/loopback/link-local IPs, single-label or `.local`/`.internal` hosts) returns an `Error: ...` string with no HTTP call and nothing signed. Previously some of these failed schema parsing and threw. Queries and URLs are trimmed; queries are capped at 400 chars.
- `max_results`/`num_results` accept `null` (= default) and out-of-range values are clamped to 1-5.
- README and tool descriptions: paid search $0.008 (was shown as $0.005). Client tag now reports the real version.

## 0.4.0 (2026-11-10)
- **Search + Read in one paid call.** New `AgentSearchSearchAndReadTool` (`agentsearch_search_and_read`) posts to `https://api.agentsearchhq.com/x402/v1/search_and_read` at **$0.015**, charged only when at least one page returns text. Default 3 results (max 5), default 8000 characters per page (max 20000); `render_fallback=true` renders at most one thin page in the same call. About 48% less than a $0.008 search plus three $0.007 extracts ($0.029), and one payment instead of four.
- Direct-only: not on the Pocket route. A Pocket or no-wallet call refuses with nothing signed. Search itself stays free by default.
- Direct per-call ceiling raised to **$0.020** (`DIRECT_MAX_PER_CALL_ATOMIC = 20000`) so a $0.015 search-and-read can settle. An old `10000` cap now refuses with a hint to raise it to `20000`. Matches `@agentsearchhq/agentsearch-mcp` 1.7.0.

## 0.3.0 (2026-11-09)

### Changed: paid calls go directly to AgentSearch's x402 API by default

- With a wallet key, paid calls now go to AgentSearch's own x402 API on Base (`https://api.agentsearchhq.com/x402/v1/...`, payee `0xC49B157887e51c21CB655f39CF65D6a4c2a4C337`) instead of the Pocket Network Agentic Portal.
- **Price change for wallet users:** search $0.008, extract $0.007, render $0.010 per call (was $0.005 on Pocket). Failed and empty calls are not charged on the direct API.
- To keep the Pocket route and its $0.005 price, set `AGENTSEARCH_PAYMENT_ROUTE=pocket` (`AGENTSEARCH_X402_DIRECT=0` also works). Any other value refuses paid calls with nothing signed.
- The per-call hard cap is now `10000` atomic units ($0.010) on the direct route and stays `5000` on Pocket. If `AGENTSEARCH_MAX_PER_CALL_ATOMIC` is set below the direct price, the refusal explains how to fix it.
- On the direct route, extract and render take only `url` (search: `query`, `max_results`); other options are dropped and listed in `payment.droppedFields`.
- Free search with no wallet is unchanged.
- New export: `paymentRoute()`.

## 0.2.1

- Free search by default; paid search is an explicit developer opt-in.
