import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { callPortal, hasWalletKey, PortalError, type PortalOperation } from "./pocket.js";
import { clientHeaders, requestTimeoutMs } from "./util.js";

export { resetSessionBudget, sessionSpentAtomic, PortalError } from "./pocket.js";

export const FREE_RELAY_URL = "https://relay.agentsearchhq.com";
export const FREE_RELAY_DAILY_LIMIT = 25;
const DOCS = "https://agentsearchhq.com/?utm_source=agentsearchhq-langchain&utm_medium=package";
const PRICING = "https://agentsearchhq.com/pricing?utm_source=agentsearchhq-langchain&utm_medium=package";
export const MODE_ENV_VAR = "AGENTSEARCH_MODE";
export const SEARCH_MODES = ["free", "paid", "auto"] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];
export const EXTRACT_FORMATS = ["markdown", "text", "html", "links"] as const;

export const FREE_LIMIT_MESSAGE =
  `Free search limit reached (up to ${FREE_RELAY_DAILY_LIMIT} searches/day per IP, subject to shared daily capacity; resets daily). ` +
  "For more search plus extract/render, set AGENTSEARCH_WALLET_PRIVATE_KEY to the key of a NEW wallet funded with a little USDC on Base " +
  "(search is $0.005 per call via x402, capped by AGENTSEARCH_MAX_TOTAL_ATOMIC, default $1.00) and opt in to paid search with " +
  `AgentSearchTool({ mode: "paid" }) or AGENTSEARCH_MODE=paid. Docs: ${DOCS}`;

export const PAID_ONLY_MESSAGE = (name: string) =>
  `${name} is paid (USDC on Base via x402; see ${PRICING}). No wallet is configured, so no call was made. ` +
  `Set AGENTSEARCH_WALLET_PRIVATE_KEY (or POCKET_PRIVATE_KEY) to the key of a NEW wallet funded with a little USDC on Base. Docs: ${DOCS}`;

export class AgentSearchError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "AgentSearchError";
  }
}

export interface AgentSearchOptions {
  /** Developer setting, never exposed to the model. "free" (default): free relay.
   *  "paid": paid search (falls back to free with a warning if no wallet key is set).
   *  "auto": paid only if a wallet key is set, else free. AGENTSEARCH_MODE overrides this. */
  mode?: SearchMode;
  /** Custom fetch (tests). */
  fetch?: typeof fetch;
}

function stripProvider(d: unknown): unknown {
  if (d && typeof d === "object" && !Array.isArray(d)) delete (d as Record<string, unknown>).provider;
  return d;
}

export async function freeSearch(query: string, maxResults?: number, f: typeof fetch = fetch): Promise<unknown> {
  const body: Record<string, unknown> = { query };
  if (maxResults !== undefined) body.max_results = maxResults;
  const res = await f(`${FREE_RELAY_URL}/v1/search`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...clientHeaders() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(requestTimeoutMs()),
  });
  const text = await res.text();
  if (res.status === 429) throw new AgentSearchError(FREE_LIMIT_MESSAGE, 429);
  if (!res.ok) throw new AgentSearchError(`AgentSearch relay HTTP ${res.status}: ${text.slice(0, 500)}`, res.status);
  try { return stripProvider(JSON.parse(text)); } catch { return { raw: text }; }
}

async function paid(op: PortalOperation, body: Record<string, unknown>): Promise<unknown> {
  const r = await callPortal(op, body);
  const env = r.response as { data?: unknown } | null;
  return { ...((stripProvider(env?.data ?? env) as object) ?? {}), payment: r.payment };
}

/** Characters of page text (markdown/text/content fields, any depth; ignores payment). */
export function textLength(v: unknown): number {
  if (Array.isArray(v)) return v.reduce((n, x) => n + textLength(x), 0);
  if (v && typeof v === "object") {
    let n = 0;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === "payment") continue;
      n += (k === "markdown" || k === "text" || k === "content") && typeof x === "string" ? x.length : textLength(x);
    }
    return n;
  }
  return 0;
}
export const THIN_CHARS = 200;

function fallbackEnabled(flag?: boolean): boolean {
  if (flag !== undefined) return flag;
  return (typeof process !== "undefined" ? process.env.AGENTSEARCH_EXTRACT_RENDER_FALLBACK ?? "" : "").trim() === "1";
}

function envMode(): SearchMode | "" {
  const v = (typeof process !== "undefined" ? process.env[MODE_ENV_VAR] ?? "" : "").trim().toLowerCase();
  return (SEARCH_MODES as readonly string[]).includes(v) ? (v as SearchMode) : "";
}

/** "paid" or "free" for one search call. Precedence: AGENTSEARCH_MODE > mode option > "free".
 *  A wallet key alone never switches search to paid. */
export function resolveSearchMode(mode?: string): "paid" | "free" {
  const chosen = envMode() || (mode ? String(mode).trim().toLowerCase() : "") || "free";
  if (!(SEARCH_MODES as readonly string[]).includes(chosen))
    throw new AgentSearchError(`mode must be one of 'free', 'paid', 'auto' (got ${JSON.stringify(mode)}). No call was made.`);
  if (chosen === "free") return "free";
  if (chosen === "auto") return hasWalletKey() ? "paid" : "free";
  if (!hasWalletKey()) {
    console.warn("AgentSearch: paid search requested, but no wallet key is set (AGENTSEARCH_WALLET_PRIVATE_KEY); using free search instead.");
    return "free";
  }
  return "paid";
}

const out = (v: unknown) => JSON.stringify(v);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function AgentSearchTool(opts: AgentSearchOptions = {}) {
  if (opts.mode !== undefined && !(SEARCH_MODES as readonly string[]).includes(opts.mode))
    throw new AgentSearchError(`mode must be 'free', 'paid' or 'auto' (got ${JSON.stringify(opts.mode)})`);
  return tool(
    async ({ query, max_results }) => {
      try {
        if (resolveSearchMode(opts.mode) === "paid") return out(await paid("search", { query, ...(max_results ? { max_results } : {}) }));
        return out(await freeSearch(query, max_results, opts.fetch));
      } catch (e) {
        return `Error: ${errText(e)}`;
      }
    },
    {
      name: "agentsearch_search",
      description:
        "Live web search. Returns up to 5 ranked results (title, url, content). Use for current facts or finding URLs. " +
        "Free tier: up to 25 searches/day per IP, subject to shared daily capacity.",
      schema: z.object({
        query: z.string().min(1).describe("Search query"),
        max_results: z.number().int().min(1).max(5).optional().describe("1-5, default 5"),
      }),
    }
  );
}

function requireWallet(name: string) {
  if (!hasWalletKey()) throw new AgentSearchError(PAID_ONLY_MESSAGE(name));
}

export function AgentSearchExtractTool() {
  return tool(
    async ({ url, formats, max_chars, render_fallback }) => {
      try {
        requireWallet("agentsearch_extract");
        const ex = (await paid("extract", { url, ...(formats ? { formats } : {}), ...(max_chars ? { max_chars } : {}) })) as Record<string, unknown>;
        if (!fallbackEnabled(render_fallback) || textLength(ex) >= THIN_CHARS) return out(ex);
        const rf = (formats ?? ["markdown"]).filter((f) => (EXTRACT_FORMATS as readonly string[]).includes(f));
        try {
          const r = (await paid("render", { url, formats: rf.length ? rf : ["markdown"], ...(max_chars ? { max_chars } : {}) })) as Record<string, unknown>;
          return out({ ...r, render_fallback: { used: true, reason: `extract returned under ${THIN_CHARS} chars`, extract_payment: ex.payment } });
        } catch (e) {
          return out({ ...ex, render_fallback: { used: false, error: errText(e) } });
        }
      } catch (e) {
        return `Error: ${errText(e)}`;
      }
    },
    {
      name: "agentsearch_extract",
      description:
        "Fetch a URL and return its main content as clean text/markdown. Fast and best for articles, docs and static pages. " +
        "If the result is empty or thin (JavaScript-heavy page, SPA, app shell), call agentsearch_render on the same URL, " +
        "or pass render_fallback=true to do that automatically (an extra paid render call). Paid (needs a wallet): $0.005 per call.",
      schema: z.object({
        url: z.string().url().describe("http(s) URL to extract"),
        formats: z.array(z.enum(EXTRACT_FORMATS)).optional().describe("Output formats, default [\"markdown\"]"),
        max_chars: z.number().int().positive().optional(),
        render_fallback: z.boolean().optional().describe("If extract returns thin content, retry with agentsearch_render (an extra paid call; pricing: https://agentsearchhq.com/pricing)"),
      }),
    }
  );
}

export function AgentSearchRenderTool() {
  return tool(
    async (args) => {
      try {
        requireWallet("agentsearch_render");
        const body = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
        return out(await paid("render", body));
      } catch (e) {
        return `Error: ${errText(e)}`;
      }
    },
    {
      name: "agentsearch_render",
      description:
        "Render a page in a real headless browser and return markdown/text/html/links (optional screenshot). Use when agentsearch_extract returns empty or thin content, or for JavaScript-heavy pages (SPAs, content loaded by scripts). Paid (needs a wallet); pricing: https://agentsearchhq.com/pricing",
      schema: z.object({
        url: z.string().url(),
        formats: z.array(z.enum(EXTRACT_FORMATS)).optional(),
        max_chars: z.number().int().positive().optional(),
        screenshot: z.boolean().optional(),
        wait_until: z.enum(["domcontentloaded", "load", "networkidle"]).optional(),
        wait_for_selector: z.string().optional(),
        wait_ms: z.number().int().min(0).optional(),
      }),
    }
  );
}

export function agentSearchTools(opts: AgentSearchOptions = {}) {
  return [AgentSearchTool(opts), AgentSearchExtractTool(), AgentSearchRenderTool()];
}
