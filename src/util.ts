export const DEFAULT_TIMEOUT_MS = 30_000;
export function requestTimeoutMs(): number {
  const n = Number(process.env.AGENTSEARCH_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 1000 && n <= 300_000 ? Math.trunc(n) : DEFAULT_TIMEOUT_MS;
}
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
export function isSecureOrLocalUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol === "https:") return true;
  if (u.protocol !== "http:") return false;
  const h = u.hostname.toLowerCase();
  return LOOPBACK.has(h) || h.endsWith(".localhost") || /^127\.\d+\.\d+\.\d+$/.test(h);
}

export const PACKAGE_NAME = "@agentsearchhq/langchain";
export const PACKAGE_VERSION = "0.5.0";

/** Anonymous package tag (name/version only) so AgentSearch can count usage per integration.
 *  Opt out with AGENTSEARCH_NO_CLIENT_TAG=1. AGENTSEARCH_SELF=1 marks our own test traffic. */
export function clientHeaders(): Record<string, string> {
  const env = (typeof process !== "undefined" ? process.env : {}) as Record<string, string | undefined>;
  const h: Record<string, string> = {};
  if ((env.AGENTSEARCH_NO_CLIENT_TAG ?? "").trim() !== "1") h["X-Agent-Client"] = `${PACKAGE_NAME}/${PACKAGE_VERSION}`;
  if ((env.AGENTSEARCH_SELF ?? "").trim() === "1") h["X-AgentSearch-Self"] = "1";
  return h;
}
