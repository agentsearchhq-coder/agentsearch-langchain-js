# Changelog

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
