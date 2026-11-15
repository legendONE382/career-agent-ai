/**
 * Vercel Serverless Function — best-effort job posting importer.
 * POST { url } -> { title, company, text }
 *
 * Browsers can't fetch job pages directly (CORS), so we do it server-side.
 * Includes SSRF protection (public hosts only, redirects re-validated).
 * Pages that need a login or are rendered purely with JavaScript (e.g. LinkedIn)
 * can't be read — the UI then asks the user to paste the text instead.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

type Req = IncomingMessage & { body?: unknown };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Browsers calling from another site are rejected (basic CSRF / hot-link guard). */
function originAllowed(req: Req): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function clientIp(req: Req): string {
  const xf = req.headers["x-forwarded-for"];
  const first = Array.isArray(xf) ? xf[0] : xf?.split(",")[0];
  if (first) return first.trim();
  try {
    return (req.socket.remoteAddress || "unknown").trim();
  } catch {
    return "unknown";
  }
}

const buckets = new Map<string, { start: number; count: number }>();

function rateLimit(req: Req, res: ServerResponse, max = 20, windowMs = 10 * 60_000): boolean {
  const ip = clientIp(req);
  const now = Date.now();
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
    send(res, 429, { error: "You're going a little fast — please wait a minute and try again." });
    return false;
  }
  return true;
}

const MAX_BYTES = 1_500_000;
const MAX_CHARS = 18_000;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function readJson(req: Req): Promise<Record<string, unknown> | null> {
  const existing = req.body;
  if (existing && typeof existing === "object" && !Buffer.isBuffer(existing)) {
    return existing as Record<string, unknown>;
  }
  let raw = "";
  if (typeof existing === "string") raw = existing;
  else if (Buffer.isBuffer(existing)) raw = existing.toString("utf8");
  else {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += buf.length;
      if (size > 50_000) return null;
      chunks.push(buf);
    }
    raw = Buffer.concat(chunks).toString("utf8");
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
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

/** Expands any textual IPv6 address into its 8 16-bit groups (null if malformed). */
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
    groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
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

  // ::, ::1, ::a.b.c.d (compatible) and ::ffff:a.b.c.d (IPv4-mapped, any notation)
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
    throw new HttpError(400, "That doesn't look like a valid URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new HttpError(400, "Only http(s) links are supported.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new HttpError(400, "That address isn't allowed.");
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new HttpError(400, "That address isn't allowed.");
    return u;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new HttpError(422, "Couldn't find that website.");
  }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new HttpError(400, "That address isn't allowed.");
  return u;
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, MAX_BYTES);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.length;
      chunks.push(value);
      if (total > MAX_BYTES) {
        await reader.cancel();
        break;
      }
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchPage(startUrl: string): Promise<string> {
  let current = startUrl;
  for (let hop = 0; hop < 5; hop++) {
    const u = await assertPublicUrl(current);
    let res: Response;
    try {
      res = await fetch(u, {
        redirect: "manual",
        signal: AbortSignal.timeout(9_000),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
    } catch {
      throw new HttpError(422, "The website took too long to respond or blocked the request.");
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, u).toString();
      continue;
    }
    if (!res.ok) throw new HttpError(422, `The website responded with an error (${res.status}).`);
    const ct = res.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml|text\/plain/i.test(ct)) throw new HttpError(422, "That link isn't a web page.");
    return readCapped(res);
  }
  throw new HttpError(422, "Too many redirects.");
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  ndash: "–",
  mdash: "—",
  bull: "•",
  hellip: "…",
};

function decodeEntities(s: string): string {
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

type Json = Record<string, unknown>;

function findJobPosting(node: unknown): Json | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findJobPosting(item);
      if (found) return found;
    }
    return null;
  }
  const obj = node as Json;
  const type = obj["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.includes("JobPosting")) return obj;
  if (obj["@graph"]) return findJobPosting(obj["@graph"]);
  return null;
}

function asText(value: unknown): string {
  if (typeof value === "string") return htmlToText(value);
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join("\n");
  if (value && typeof value === "object") {
    const o = value as Json;
    if (typeof o.name === "string") return o.name;
    if (typeof o.description === "string") return htmlToText(o.description);
  }
  return "";
}

function meta(html: string, prop: string): string {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decodeEntities(content).trim() : "";
}

function extract(html: string): { title: string; company: string; text: string } {
  const ldBlocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of ldBlocks) {
    try {
      const job = findJobPosting(JSON.parse(block[1].trim()));
      if (job && job.description) {
        const title = asText(job.title);
        const company = asText(job.hiringOrganization);
        const section = (label: string, value: unknown) => {
          const t = asText(value);
          return t ? `\n${label}:\n${t}` : "";
        };
        const location = asText(job.jobLocation);
        const parts: string[] = [
          title ? `Job title: ${title}` : "",
          company ? `Company: ${company}` : "",
          location ? `Location: ${location}` : "",
          "",
          asText(job.description),
          section("Responsibilities", job.responsibilities),
          section("Qualifications", job.qualifications),
          section("Skills", job.skills),
          section("Experience", job.experienceRequirements),
        ];
        const text = parts.filter((p, i) => p !== "" || i === 3).join("\n").trim();
        if (text.length > 200) return { title, company, text };
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  }

  const rawTitle = meta(html, "og:title") || decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
  const company = meta(html, "og:site_name");
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html.match(/<article[\s\S]*?<\/article>/i)?.[0];
  const stripped = (main && htmlToText(main).length > 400 ? main : html).replace(
    /<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi,
    " ",
  );
  return { title: rawTitle, company, text: htmlToText(stripped) };
}

export default async function handler(req: Req, res: ServerResponse) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return send(res, 405, { error: "Method not allowed" });
    }
    if (!originAllowed(req)) return send(res, 403, { error: "Request not allowed." });
    if (!rateLimit(req, res, 20)) return;
    const body = await readJson(req);
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    if (!url) throw new HttpError(400, "Please provide a job link.");
    const html = await fetchPage(url);
    const { title, company, text } = extract(html);
    if (text.length < 300) {
      throw new HttpError(
        422,
        "Couldn't read a job description from that page (it may need a login or load with JavaScript). Please paste the job text instead.",
      );
    }
    return send(res, 200, { title, company, text: text.slice(0, MAX_CHARS) });
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    console.error("[careeragent] job import error:", err);
    return send(res, 500, { error: "Something went wrong while reading that page." });
  }
}
