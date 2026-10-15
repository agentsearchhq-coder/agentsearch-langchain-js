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
