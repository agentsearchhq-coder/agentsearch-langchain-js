/** Client-side input checks (0.4.1). Bad input returns an "Error: ..." string before any HTTP request,
 *  so it never counts against the free relay's per-IP limits and nothing is signed. */
import { isIP } from "node:net";

export const MAX_QUERY_CHARS = 400;
export const MIN_QUERY_CHARS = 2;
const NOTHING = " Nothing was sent or charged.";
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet", ".localdomain", ".home.arpa"];

export class InvalidInputError extends Error {
  constructor(message: string) { super(message + NOTHING); this.name = "InvalidInputError"; }
}

const QUERY_KEYS = ["query", "q", "input", "search_query", "text", "value"];
const COUNT_KEYS = ["max_results", "num_results", "k", "limit", "count", "value"];

/** Unwrap a tool-input object ({query: "x", max_results: 3}) that a caller passed where a scalar was expected.
 *  Returns the first matching key's value (recursively), or undefined when the object has none of the keys
 *  (for example a LangChain RunnableConfig handed in as the second argument). */
function unwrap(v: unknown, keys: string[]): unknown {
  for (let depth = 0; depth < 4; depth++) {
    if (Array.isArray(v)) { v = v.find((x) => typeof x === "string" || typeof x === "number" || (x && typeof x === "object")); continue; }
    if (!v || typeof v !== "object") return v;
    const o = v as Record<string, unknown>;
    const k = keys.find((x) => o[x] !== undefined && o[x] !== null);
    if (k === undefined) return undefined;
    v = o[k];
  }
  return v && typeof v === "object" ? undefined : v;
}

export function checkQuery(raw: unknown): string {
  let q = unwrap(raw, QUERY_KEYS);
  if (typeof q === "number" && Number.isFinite(q)) q = String(q);
  if (typeof q !== "string") throw new InvalidInputError('query is required: pass a non-empty search string, e.g. {"query": "latest LangChain release"}.');
  const s = q.trim();
  if (!s) throw new InvalidInputError("query is empty or whitespace-only: pass a non-empty search string.");
  if (s.length < MIN_QUERY_CHARS) throw new InvalidInputError(`query ${JSON.stringify(s)} is too short (minimum ${MIN_QUERY_CHARS} characters): rewrite it as a real search query, e.g. a few keywords. Don't retry it unchanged.`);
  if (s.length > MAX_QUERY_CHARS) throw new InvalidInputError(`query is ${s.length} characters; keep it under ${MAX_QUERY_CHARS}.`);
  return s;
}

/** undefined/null/unusable object -> undefined (server default); tool-input objects and numeric strings are unwrapped;
 *  out-of-range values are clamped. A non-numeric string throws. */
export function checkCount(raw: unknown, name: string, lo = 1, hi = 5): number | undefined {
  const v = unwrap(raw, COUNT_KEYS);
  if (v === undefined || v === null || v === "" || typeof v === "boolean" || typeof v === "object") return undefined;
  const n = typeof v === "string" ? Number(v.trim()) : Number(v);
  if (!Number.isFinite(n)) throw new InvalidInputError(`${name} must be a whole number from ${lo} to ${hi} (or omitted for the default).`);
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

/** Like checkCount but never throws: anything unusable means "use the default". */
export function coerceCount(raw: unknown, name = "max_results", lo = 1, hi = 5): number | undefined {
  try { return checkCount(raw, name, lo, hi); } catch { return undefined; }
}

function privateIp(h: string): boolean {
  const v = isIP(h);
  if (v === 4) {
    const [a, b] = h.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (v === 6) {
    const x = h.toLowerCase();
    return x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe8") || x.startsWith("fe9") ||
      x.startsWith("fea") || x.startsWith("feb") || x.startsWith("ff") || x.startsWith("::ffff:");
  }
  return false;
}

export function checkUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) throw new InvalidInputError("url is required: pass a full http(s) URL, e.g. https://example.com/page.");
  const s = raw.trim();
  if (/\s/.test(s)) throw new InvalidInputError("url contains spaces; pass a single full http(s) URL.");
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) throw new InvalidInputError(`url must start with http:// or https:// (got ${s.slice(0, 200)}). Did you mean https://${s.slice(0, 200)}?`);
  let u: URL;
  try { u = new URL(s); } catch { throw new InvalidInputError(`url is not a valid URL: ${s.slice(0, 200)}.`); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new InvalidInputError(`url must start with http:// or https:// (got ${s.slice(0, 200)}).`);
  if (u.username || u.password || /^[a-z]+:\/\/[^/]*@/i.test(s)) throw new InvalidInputError("url must not contain a username or password.");
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) throw new InvalidInputError(`url has no host: ${s.slice(0, 200)}.`);
  if (isIP(host)) {
    if (privateIp(host)) throw new InvalidInputError("url points at a private, loopback or reserved IP address; only public web pages can be read.");
  } else if (host === "localhost" || !host.includes(".") || BLOCKED_SUFFIXES.some((x) => host.endsWith(x))) {
    throw new InvalidInputError(`url host '${host}' is not a public internet hostname; only public web pages can be read.`);
  }
  return s;
}
