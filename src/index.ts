import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { callPortal, hasWalletKey, PortalError, type PortalOperation } from "./pocket.js";
import { clientHeaders, requestTimeoutMs } from "./util.js";

export { resetSessionBudget, sessionSpentAtomic, PortalError } from "./pocket.js";

export const FREE_RELAY_URL = "https://relay.agentsearchhq.com";
export const FREE_RELAY_DAILY_LIMIT = 25;
const DOCS = "https://agentsearchhq.com/?utm_source=agentsearchhq-langchain&utm_medium=package";

export const FREE_LIMIT_MESSAGE =
  `Free search limit reached (${FREE_RELAY_DAILY_LIMIT} searches per day per user; resets daily). ` +
  "For unlimited search plus extract/render, set AGENTSEARCH_WALLET_PRIVATE_KEY to the key of a NEW wallet funded with a little USDC on Base " +
  `($0.005 per call via x402, capped by AGENTSEARCH_MAX_TOTAL_ATOMIC, default $1.00). Docs: ${DOCS}`;

export const PAID_ONLY_MESSAGE = (name: string) =>
  `${name} is paid ($0.005 per call in USDC on Base via x402). No wallet is configured, so no call was made. ` +
  `Set AGENTSEARCH_WALLET_PRIVATE_KEY to the key of a NEW wallet funded with a little USDC on Base. Docs: ${DOCS}`;

export class AgentSearchError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "AgentSearchError";
  }
}

export interface AgentSearchOptions {
  /** "auto" (default): paid if a wallet key env var is set, else free relay. */
  mode?: "auto" | "free" | "paid";
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

function usePaid(mode: AgentSearchOptions["mode"] = "auto"): boolean {
  if (mode === "free") return false;
  if (mode === "paid") return true;
  return hasWalletKey();
}

const out = (v: unknown) => JSON.stringify(v);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function AgentSearchTool(opts: AgentSearchOptions = {}) {
  return tool(
    async ({ query, max_results }) => {
      try {
        if (usePaid(opts.mode)) return out(await paid("search", { query, ...(max_results ? { max_results } : {}) }));
        return out(await freeSearch(query, max_results, opts.fetch));
      } catch (e) {
        return `Error: ${errText(e)}`;
      }
    },
    {
      name: "agentsearch_search",
      description:
        "Live web search. Returns up to 5 ranked results (title, url, content). Use for current facts or finding URLs.",
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
        const rf = (formats ?? ["markdown"]).filter((f) => ["markdown", "text", "html", "links"].includes(f));
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
        "or pass render_fallback=true to do that automatically (a second $0.005 call). Paid: $0.005 per call (needs a wallet).",
      schema: z.object({
        url: z.string().url().describe("http(s) URL to extract"),
        formats: z.array(z.string()).optional().describe("e.g. [\"markdown\"]"),
        max_chars: z.number().int().positive().optional(),
        render_fallback: z.boolean().optional().describe("If extract returns thin content, retry with render (extra $0.005)"),
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
        "Render a page in a real headless browser and return markdown/text/html/links (optional screenshot). Use when agentsearch_extract returns empty or thin content, or for JavaScript-heavy pages (SPAs, content loaded by scripts). Paid: $0.005 per call (needs a wallet).",
      schema: z.object({
        url: z.string().url(),
        formats: z.array(z.enum(["markdown", "text", "html", "links"])).optional(),
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
