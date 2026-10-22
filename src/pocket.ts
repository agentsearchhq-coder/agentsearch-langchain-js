/**
 * Pay-per-call mode: call AgentSearch services on the Pocket Network Agentic Portal
 * (https://agent.pocket.network) and pay each call over x402 v2 (exact scheme,
 * EIP-3009 TransferWithAuthorization, USDC on Base).
 *
 * Flow: unpaid POST -> 402 with PAYMENT-REQUIRED -> every limit is checked BEFORE
 * signing -> retry once with PAYMENT-SIGNATURE -> 200 with the portal envelope
 * {portal, data} and the receipt in PAYMENT-RESPONSE.
 *
 * The private key is read from env and used only to sign; it is not included in tool output or errors.
 */
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { isSecureOrLocalUrl, requestTimeoutMs, clientHeaders } from "./util.js";

export const DEFAULT_PORTAL_URL = "https://agent.pocket.network";
/** Base mainnet, CAIP-2. */
export const BASE_NETWORK = "eip155:8453";
/** Native USDC on Base. */
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
/** The portal's payee for the AgentSearch services (services.json rails[base].payToAddress). */
export const PORTAL_PAYEE = "0xF732ea490c5766071785a2310523f7fA2CEbB829";
/** $0.005 in USDC atomic units (6 decimals). Hard ceiling: never signs more per call. */
export const MAX_PER_CALL_ATOMIC = 5000n;
/** Default session cap: $1.00. */
export const DEFAULT_SESSION_CAP_ATOMIC = 1_000_000n;

export type PortalOperation = "search" | "extract" | "render";

export const PORTAL_SERVICES: Record<PortalOperation, { serviceId: string; path: string }> = {
  search: { serviceId: "agentsearch-web-search-v1", path: "/v1/search" },
  extract: { serviceId: "agentsearch-web-extract-v1", path: "/v1/extract" },
  render: { serviceId: "agentsearch-web-render-v1", path: "/v1/render" },
};

/** Wallet key env vars, in priority order. POCKET_PRIVATE_KEY mirrors @pocket-network/agentic-portal-mcp. */
export const KEY_ENV_VARS = ["AGENTSEARCH_WALLET_PRIVATE_KEY", "POCKET_PRIVATE_KEY"] as const;

export const SETUP_MESSAGE = [
  "This AgentSearch paid tool (agentsearch_search in paid mode, agentsearch_extract or agentsearch_render) needs a wallet.",
  "Set AGENTSEARCH_WALLET_PRIVATE_KEY (or POCKET_PRIVATE_KEY) in the environment of the Node.js process running your LangChain agent to the 64-hex private key of a NEW wallet made only for this.",
  "Fund that wallet with a little USDC on Base (for example $1). No ETH is needed: the x402 facilitator pays gas.",
  "Calls are paid through the Pocket Network Agentic Portal (https://agent.pocket.network) over x402, capped per call (AGENTSEARCH_MAX_PER_CALL_ATOMIC) and per process (AGENTSEARCH_MAX_TOTAL_ATOMIC, default 1000000 = $1.00).",
  "Search is free by default; paid search is opt-in with AgentSearchTool({ mode: \"paid\" }) or AGENTSEARCH_MODE=paid. Pricing: https://agentsearchhq.com/pricing",
].join(" ");

export class PortalError extends Error {
  constructor(
    message: string,
    readonly detail: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "PortalError";
  }
}

/** Reads the wallet key without ever echoing it. Returns undefined if unset. */
export function readWalletKey(): `0x${string}` | undefined {
  for (const name of KEY_ENV_VARS) {
    const raw = process.env[name]?.trim();
    if (!raw) continue;
    if (!/^(0x)?[0-9a-fA-F]{64}$/.test(raw)) {
      throw new PortalError(
        `${name} is set but is not a private key (expected 64 hex characters, optional 0x prefix). The value is not shown. Nothing was signed.`
      );
    }
    return (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
  }
  return undefined;
}

export function hasWalletKey(): boolean {
  return KEY_ENV_VARS.some((n) => Boolean(process.env[n]?.trim()));
}

function atomicEnv(names: string[], fallback: bigint): { value: bigint; source?: string } {
  for (const name of names) {
    const raw = process.env[name]?.trim();
    if (!raw) continue;
    if (!/^\d+$/.test(raw)) {
      throw new PortalError(`${name} must be a whole number of USDC atomic units (1000000 = $1.00). Nothing was signed.`);
    }
    return { value: BigInt(raw), source: name };
  }
  return { value: fallback };
}

export interface PortalSettings {
  portalUrl: string;
  sessionCapAtomic: bigint;
  perCallCapAtomic: bigint;
}

export function loadPortalSettings(): PortalSettings {
  const portalUrl = (process.env.AGENTSEARCH_PORTAL_URL?.trim() || DEFAULT_PORTAL_URL).replace(/\/+$/, "");
  if (!isSecureOrLocalUrl(portalUrl)) {
    throw new PortalError("AGENTSEARCH_PORTAL_URL must be https:// (http only for localhost). Nothing was signed.");
  }
  const session = atomicEnv(["AGENTSEARCH_MAX_TOTAL_ATOMIC", "POCKET_MAX_TOTAL_ATOMIC"], DEFAULT_SESSION_CAP_ATOMIC);
  const perCall = atomicEnv(["AGENTSEARCH_MAX_PER_CALL_ATOMIC", "POCKET_MAX_PER_CALL_ATOMIC"], MAX_PER_CALL_ATOMIC);
  return {
    portalUrl,
    sessionCapAtomic: session.value,
    // A per-call setting can only lower the hard $0.005 ceiling, never raise it.
    perCallCapAtomic: perCall.value < MAX_PER_CALL_ATOMIC ? perCall.value : MAX_PER_CALL_ATOMIC,
  };
}

/** Session budget: counted when a payment is SIGNED (a signed authorization may be settled). */
class SessionBudget {
  spent = 0n;
  reserved = 0n;
  remaining(cap: bigint): bigint {
    const r = cap - this.spent - this.reserved;
    return r > 0n ? r : 0n;
  }
}
let budget = new SessionBudget();
/** Test hook. */
export function resetSessionBudget(): void {
  budget = new SessionBudget();
}
export function sessionSpentAtomic(): bigint {
  return budget.spent;
}

export function atomicToUsd(a: bigint | string): string {
  const n = BigInt(a);
  const whole = n / 1_000_000n;
  const frac = (n % 1_000_000n).toString().padStart(6, "0");
  return `$${whole}.${frac}`;
}

const eqAddr = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

interface Accept {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
}

/** Picks the one option this server is willing to sign, or explains why none qualifies. */
export function selectAccept(accepts: Accept[], ceiling: bigint): Accept {
  const why: string[] = [];
  for (const a of accepts ?? []) {
    if (a.scheme !== "exact") { why.push(`${a.scheme} scheme`); continue; }
    if (a.network !== BASE_NETWORK) { why.push(`network ${a.network}`); continue; }
    if (!eqAddr(a.asset, USDC_BASE)) { why.push(`asset ${a.asset} is not USDC on Base`); continue; }
    if (!eqAddr(a.payTo, PORTAL_PAYEE)) { why.push(`payee ${a.payTo} is not the portal's`); continue; }
    if (!/^\d+$/.test(String(a.amount))) { why.push(`amount ${a.amount} is not an integer`); continue; }
    const amt = BigInt(a.amount);
    if (amt <= 0n) { why.push(`amount ${a.amount}`); continue; }
    if (amt > ceiling) { why.push(`amount ${a.amount} atomic (${atomicToUsd(amt)}) is above the ${ceiling} atomic (${atomicToUsd(ceiling)}) limit`); continue; }
    return a;
  }
  throw new PortalError(`Refusing to pay: no acceptable payment option (${why.join("; ") || "none offered"}). Nothing was signed.`, {
    offered: (accepts ?? []).map((a) => ({ scheme: a.scheme, network: a.network, amount: a.amount, asset: a.asset, payTo: a.payTo })),
  });
}

interface RawResponse {
  status: number;
  headers: Headers;
  body: unknown;
  text: string;
}

async function post(url: string, body: unknown, extraHeaders: Record<string, string>): Promise<RawResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...clientHeaders(), ...extraHeaders },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(requestTimeoutMs()),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  return { status: res.status, headers: res.headers, body: parsed, text };
}

/** Portal errors are not enveloped: {error:{code,message,retryable}}. */
export function portalErrorInfo(r: { status: number; headers: Headers; body: unknown; text: string }) {
  const e = (r.body as { error?: { code?: unknown; message?: unknown; retryable?: unknown } } | null)?.error;
  const code = typeof e?.code === "string" ? e.code : `HTTP_${r.status}`;
  const message = typeof e?.message === "string" ? e.message : r.text.slice(0, 500);
  const retryable =
    typeof e?.retryable === "boolean" ? e.retryable : r.status === 429 || r.status >= 500;
  const retryAfter = r.headers.get("retry-after");
  return { status: r.status, code, message, retryable, ...(retryAfter ? { retryAfter } : {}) };
}

export interface PortalResult {
  payment: Record<string, unknown>;
  spend: { sessionSpentAtomic: string; sessionCapAtomic: string; sessionRemainingAtomic: string };
  /** The portal envelope {portal, data}, unchanged. data is untrusted third-party content. */
  response: unknown;
  /** Present when HTTP 200 carried data.error (e.g. the target site failed). */
  upstreamError?: unknown;
}

export async function callPortal(op: PortalOperation, body: Record<string, unknown>): Promise<PortalResult> {
  const settings = loadPortalSettings();
  const key = readWalletKey();
  if (!key) throw new PortalError(SETUP_MESSAGE);
  const { serviceId, path } = PORTAL_SERVICES[op];
  const url = `${settings.portalUrl}/v1/${serviceId}${path}`;

  // 1) Unpaid request -> expect 402 terms.
  const unpaid = await post(url, body, {});
  if (unpaid.status !== 402) {
    const info = portalErrorInfo(unpaid);
    throw new PortalError(
      `The portal answered ${unpaid.status} ${info.code} before payment: ${info.message} (retryable: ${info.retryable}). Nothing was signed.`,
      { error: info }
    );
  }
  const http = new x402HTTPClient(new x402Client());
  let required: { x402Version: number; resource?: { url?: string }; accepts: Accept[] };
  try {
    required = http.getPaymentRequiredResponse((n) => unpaid.headers.get(n), unpaid.body) as never;
  } catch (e) {
    throw new PortalError(`The portal's 402 is not valid x402 v2 (${e instanceof Error ? e.message : String(e)}). Nothing was signed.`);
  }
  if (required.x402Version !== 2) throw new PortalError(`Unsupported x402Version ${required.x402Version}. Nothing was signed.`);
  const resUrl = required.resource?.url ?? "";
  if (!resUrl.replace(/\/+$/, "").endsWith(`/v1/${serviceId}`)) {
    throw new PortalError(`The 402 is for resource ${resUrl}, not ${serviceId}. Nothing was signed.`);
  }

  // 2) Limits, checked before anything is signed.
  const remaining = budget.remaining(settings.sessionCapAtomic);
  const ceiling = settings.perCallCapAtomic < remaining ? settings.perCallCapAtomic : remaining;
  if (ceiling <= 0n) {
    throw new PortalError(
      `Session spend cap reached: ${atomicToUsd(budget.spent)} of ${atomicToUsd(settings.sessionCapAtomic)} signed. Raise AGENTSEARCH_MAX_TOTAL_ATOMIC and restart to spend more. Nothing was signed.`
    );
  }
  const chosen = selectAccept(required.accepts, ceiling);
  const amount = BigInt(chosen.amount);

  // 3) Sign with the reference x402 client, restricted to the option chosen above.
  const account = privateKeyToAccount(key);
  const selector = (_v: number, options: Accept[]) => {
    const match = options.find(
      (o) => o.scheme === chosen.scheme && o.network === chosen.network && eqAddr(o.asset, chosen.asset) && eqAddr(o.payTo, chosen.payTo) && o.amount === chosen.amount
    );
    if (!match) throw new PortalError("Selected option disappeared. Nothing was signed.");
    return match;
  };
  const client = new x402Client(selector as never).setSpendControls(false);
  registerExactEvmScheme(client, { signer: account, paymentRequirementsSelector: selector as never });
  const payer = new x402HTTPClient(client);

  budget.reserved += amount;
  let signedPayload: { accepted?: Accept; payload?: { authorization?: Record<string, string> } };
  try {
    signedPayload = (await payer.createPaymentPayload(required as never)) as never;
  } catch (e) {
    budget.reserved -= amount;
    if (e instanceof PortalError) throw e;
    throw new PortalError(`Could not build the payment (${e instanceof Error ? e.message : String(e)}). Nothing was signed.`);
  }
  // Belt and braces: re-check what was actually signed before it leaves this process.
  const auth = signedPayload.payload?.authorization;
  if (!auth || !eqAddr(auth.to, PORTAL_PAYEE) || BigInt(auth.value ?? "0") !== amount || signedPayload.accepted?.network !== BASE_NETWORK || !eqAddr(signedPayload.accepted?.asset, USDC_BASE)) {
    budget.reserved -= amount;
    throw new PortalError("The signed authorization does not match the approved terms; it was discarded and not sent.");
  }
  budget.reserved -= amount;
  budget.spent += amount; // counted at signing: a signed authorization may be settled.

  // 4) Retry once with PAYMENT-SIGNATURE.
  let paid: RawResponse;
  try {
    paid = await post(url, body, payer.encodePaymentSignatureHeader(signedPayload as never));
  } catch (e) {
    throw new PortalError(
      `A payment of ${atomicToUsd(amount)} was signed but the paid request failed (${e instanceof Error ? e.message : String(e)}). It may or may not be settled; check the wallet before retrying.`,
      { paymentSigned: true }
    );
  }
  const spend = {
    sessionSpentAtomic: budget.spent.toString(),
    sessionCapAtomic: settings.sessionCapAtomic.toString(),
    sessionRemainingAtomic: budget.remaining(settings.sessionCapAtomic).toString(),
  };
  if (paid.status < 200 || paid.status >= 300) {
    const info = portalErrorInfo(paid);
    throw new PortalError(
      `The portal answered ${paid.status} ${info.code}: ${info.message} (retryable: ${info.retryable}${info.retryAfter ? `, retry after ${info.retryAfter}s` : ""}). Per the portal, a non-2xx answer is not settled, so you should not be charged; the signed ${atomicToUsd(amount)} still counts against this session's cap.`,
      { error: info, paymentSigned: true, settled: false, spend }
    );
  }

  let receipt: { success?: boolean; transaction?: string; network?: string; payer?: string } | undefined;
  const header = paid.headers.get("PAYMENT-RESPONSE");
  if (header) {
    try {
      receipt = decodePaymentResponseHeader(header) as never;
    } catch {
      receipt = undefined;
    }
  }
  const tx = receipt?.transaction || null;
  const payment: Record<string, unknown> = {
    amountAtomic: amount.toString(),
    amountUsd: atomicToUsd(amount),
    asset: "USDC",
    assetAddress: USDC_BASE,
    network: BASE_NETWORK,
    payTo: PORTAL_PAYEE,
    payer: account.address,
    serviceId,
    settled: receipt?.success ?? false,
    transaction: tx,
    ...(tx ? { explorer: `https://basescan.org/tx/${tx}` } : {}),
    ...(receipt ? {} : { note: "No settlement receipt (PAYMENT-RESPONSE) was returned, so this payment is unconfirmed." }),
  };
  const data = (paid.body as { data?: { error?: unknown } } | null)?.data;
  const upstreamError = data && typeof data === "object" && data.error ? data.error : undefined;
  return { payment, spend, response: paid.body, ...(upstreamError ? { upstreamError } : {}) };
}
