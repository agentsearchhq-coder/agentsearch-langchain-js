# Changelog

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
