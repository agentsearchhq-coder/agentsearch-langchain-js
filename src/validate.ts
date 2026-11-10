/** Client-side input checks (0.4.1). Bad input returns an "Error: ..." string before any HTTP request,
 *  so it never counts against the free relay's per-IP limits and nothing is signed. */
import { isIP } from "node:net";

export const MAX_QUERY_CHARS = 400;
const NOTHING = " Nothing was sent or charged.";
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet", ".localdomain", ".home.arpa"];

export class InvalidInputError extends Error {
  constructor(message: string) { super(message + NOTHING); this.name = "InvalidInputError"; }
}

export function checkQuery(q: unknown): string {
  if (typeof q !== "string") throw new InvalidInputError('query is required: pass a non-empty search string, e.g. {"query": "latest LangChain release"}.');
  const s = q.trim();
  if (!s) throw new InvalidInputError("query is empty or whitespace-only: pass a non-empty search string.");
  if (s.length > MAX_QUERY_CHARS) throw new InvalidInputError(`query is ${s.length} characters; keep it under ${MAX_QUERY_CHARS}.`);
  return s;
}

/** undefined/null -> undefined (server default); out-of-range values are clamped. */
export function checkCount(v: unknown, name: string, lo = 1, hi = 5): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new InvalidInputError(`${name} must be a whole number from ${lo} to ${hi} (or omitted for the default).`);
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
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
