/**
 * Shared utilities for CareerAgent serverless API.
 * All user-facing errors go through HttpError; operational detail goes to server logs only.
 * The API key is never logged or included in responses.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** HTTP request shape Vercel passes to serverless functions. */
export type Req = IncomingMessage & { body?: unknown };

/** Consistent JSON response helper. */
export function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

/** Structured HTTP error with a stable code for the client. */
export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

/** Same-origin / no-origin guard to block cross-site hot-linking. */
export function originAllowed(req: Req): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function clientIp(req: Req): string {
  const xf = req.headers["x-forwarded-for"];
  const first = Array.isArray(xf) ? xf[0] : xf?.split(",")[0];
  if (first) return first.trim();
  try {
    return (req.socket.remoteAddress || "unknown").trim();
  } catch {
    return "unknown";
  }
}

/** Best-effort per-instance rate limit (serverless instances are ephemeral). */
export function rateLimit(req: Req, res: ServerResponse, max = 40, windowMs = 10 * 60_000): boolean {
  const ip = clientIp(req);
  const now = Date.now();
  const buckets = (globalThis as unknown as { __buckets?: Map<string, { start: number; count: number }> }).__buckets ??
    new Map<string, { start: number; count: number }>();
  (globalThis as unknown as { __buckets?: Map<string, { start: number; count: number }> }).__buckets = buckets;

  let b = buckets.get(ip);
  if (!b || now - b.start > windowMs) {
    b = { start: now, count: 0 };
    buckets.set(ip, b);
  }
  b.count++;
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (now - v.start > windowMs) buckets.delete(k);
  }
  if (b.count > max) {
    res.setHeader("Retry-After", "60");
    send(res, 429, { error: "Too many requests. Please wait a minute and try again.", code: "rate_limit" });
    return false;
  }
  return true;
}

/** Read and parse a JSON request body with a hard size cap. Vercel may pre-parse req.body. */
export async function readRequestBody(req: Req, maxBytes: number): Promise<unknown> {
  const existing = req.body;
  if (existing !== undefined && existing !== null) {
    if (typeof existing === "string") {
      if (existing.length > maxBytes) throw new HttpError(413, "payload_too_large", "Request body is too large.");
      try {
        return JSON.parse(existing);
      } catch {
        return null;
      }
    }
    if (Buffer.isBuffer(existing)) {
      if (existing.length > maxBytes) throw new HttpError(413, "payload_too_large", "Request body is too large.");
      try {
        return JSON.parse(existing.toString("utf8"));
      } catch {
        return null;
      }
    }
    return existing;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buf.length;
    if (size > maxBytes) throw new HttpError(413, "payload_too_large", "Request body is too large.");
    chunks.push(buf);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

export function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/* ───────────────────────── SSRF protection ───────────────────────── */

export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  // Invalid IP → treat as potentially unsafe (private/blocked)
  if (parts.some((p) => Number.isNaN(p)) || parts.length !== 4) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

export function parseIPv6(input: string): number[] | null {
  let s = input.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  const embedded = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (embedded) {
    const o = embedded[2].split(".").map(Number);
    if (o.some((n) => n > 255)) return null;
    s = `${embedded[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  let groups: string[];
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    groups = head;
  } else {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...Array(missing).fill("0"), ...tail];
  }
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.some((n) => Number.isNaN(n)) ? null : nums;
}

export function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family !== 6) return true;

  const g = parseIPv6(ip);
  if (!g) return true;
  const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

  // ::, ::1, ::a.b.c.d (compatible) and ::ffff:a.b.c.d (IPv4-mapped)
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0 || g[5] === 0xffff)) {
    if (g[5] === 0 && g[6] === 0 && g[7] <= 1) return true;
    return isPrivateIPv4(v4(g[6], g[7]));
  }
  // NAT64 64:ff9b::/96
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateIPv4(v4(g[6], g[7]));
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError(400, "invalid_url", "That doesn't look like a valid URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new HttpError(400, "invalid_protocol", "Only http(s) links are supported.");
  }
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new HttpError(400, "blocked_address", "That address isn't allowed.");
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new HttpError(400, "blocked_address", "That address isn't allowed.");
    return u;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new HttpError(422, "dns_failure", "Couldn't find that website.");
  }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw new HttpError(400, "blocked_address", "That address isn't allowed.");
  }
  return u;
}

export function fetchWithTimeout(url: string | URL, init: RequestInit, ms: number): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}

/* ───────────────────────── HTML utilities ───────────────────────── */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: "–", mdash: "—",
  bull: "•", hellip: "…",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, g: string) => {
    if (g[0] === "#") {
      const code = g[1].toLowerCase() === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    }
    return NAMED_ENTITIES[g.toLowerCase()] ?? m;
  });
}

export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<\s*li[^>]*>/gi, "\n• ");
  s = s.replace(/<\s*(br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/section|\/article|\/ul|\/ol)\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = s
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/* ───────────────────────── Gemini error mapping ───────────────────────── */

export type HealthStatus =
  | "not_configured"
  | "invalid_key"
  | "quota_exhausted"
  | "model_unavailable"
  | "operational"
  | "upstream_failure";

export type GeminiErrorCode =
  | "not_configured"
  | "invalid_key"
  | "quota_exhausted"
  | "model_unavailable"
  | "rate_limit"
  | "upstream_failure"
  | "bad_response"
  | "timeout"
  | "too_large"
  | "blocked"
  | "api";

export interface GeminiError extends Error {
  code: GeminiErrorCode;
  status?: number;
}

export function makeGeminiError(code: GeminiErrorCode, message: string, status?: number): GeminiError {
  const e = new Error(message) as GeminiError;
  e.name = "GeminiError";
  e.code = code;
  e.status = status;
  return e;
}

export function isGeminiError(e: unknown): e is GeminiError {
  return e instanceof Error && (e as GeminiError).code !== undefined;
}

export function mapGeminiHttpError(status: number, data: unknown, raw: string): GeminiError {
  let message = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  if (data && typeof data === "object") {
    const d = data as { error?: { message?: string; code?: string; status?: string } };
    if (d.error?.message) message = d.error.message;
  }

  switch (status) {
    case 400:
      return makeGeminiError("api", `Gemini API rejected the request: ${message}`, 400);
    case 401:
    case 403:
      return makeGeminiError("invalid_key", "The Gemini API key is invalid or unauthorized.", status);
    case 404:
      return makeGeminiError("model_unavailable", "The configured Gemini model is not available.", status);
    case 413:
      return makeGeminiError("too_large", "The request payload is too large.", status);
    case 429:
      return makeGeminiError("quota_exhausted", "Gemini API quota has been exhausted. Please try again later.", status);
    case 502:
    case 503:
      return makeGeminiError("upstream_failure", "Gemini service is temporarily unavailable.", status);
    case 504:
      return makeGeminiError("timeout", "Gemini request timed out.", status);
    case 500:
    default:
      return makeGeminiError("upstream_failure", `Gemini API returned an error (${status}).`, status);
  }
}
