/**
 * Vercel Serverless Function — job description importing.
 *
 * POST /api/job
 * Body: { url: string }
 *
 * Extracts job information from a public job posting URL.
 * Supports JSON-LD, Open Graph metadata, and HTML fallback.
 * Protected against SSRF, DNS rebinding, and private network access.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  send,
  readRequestBody,
  isObj,
  HttpError,
  rateLimit,
  originAllowed,
  assertPublicUrl,
  fetchWithTimeout,
  htmlToText,
  decodeEntities,
} from "./core";

const MAX_BYTES = 1_500_000;
const MAX_CHARS = 18_000;
const FETCH_TIMEOUT_MS = 9_000;
const MAX_REDIRECTS = 5;

class JobError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "JobError";
    this.status = status;
    this.code = code;
  }
}

type Req = IncomingMessage & { body?: unknown };

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: "–", mdash: "—",
  bull: "•", hellip: "…",
};

function decodeEntitiesLocal(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, g: string) => {
    if (g[0] === "#") {
      const code = g[1].toLowerCase() === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    }
    return NAMED_ENTITIES[g.toLowerCase()] ?? m;
  });
}

function htmlToTextLocal(html: string): string {
  let s = html;
  s = s.replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<\s*li[^>]*>/gi, "\n• ");
  s = s.replace(/<\s*(br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/section|\/article|\/ul|\/ol)\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntitiesLocal(s);
  s = s
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function isPrivateIPv4Local(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  const [a, b] = parts;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function parseIPv6Local(input: string): number[] | null {
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

function isPrivateIpLocal(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIPv4Local(ip);
  if (family !== 6) return true;
  const g = parseIPv6Local(ip);
  if (!g) return true;
  const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0 || g[5] === 0xffff)) {
    if (g[5] === 0 && g[6] === 0 && g[7] <= 1) return true;
    return isPrivateIPv4Local(v4(g[6], g[7]));
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateIPv4Local(v4(g[6], g[7]));
  if ((g[0] & 0xfe00) === 0xfc00) return true;
  if ((g[0] & 0xffc0) === 0xfe80) return true;
  if ((g[0] & 0xff00) === 0xff00) return true;
  return false;
}

async function assertPublicUrlLocal(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new JobError(400, "invalid_url", "That doesn't look like a valid URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new JobError(400, "invalid_protocol", "Only http(s) links are supported.");
  }
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new JobError(400, "blocked_address", "That address isn't allowed.");
  }
  if (isIP(host)) {
    if (isPrivateIpLocal(host)) throw new JobError(400, "blocked_address", "That address isn't allowed.");
    return u;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new JobError(422, "dns_failure", "Couldn't find that website.");
  }
  if (!addrs.length || addrs.some((a) => isPrivateIpLocal(a.address))) {
    throw new JobError(400, "blocked_address", "That address isn't allowed.");
  }
  return u;
}

async function readCapped(res: Response): Promise<string> {
  const text = await res.text();
  return text.slice(0, MAX_BYTES);
}

async function fetchPage(startUrl: string): Promise<string> {
  let current = startUrl;
  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    const u = await assertPublicUrlLocal(current);
    let res: Response;
    try {
      res = await fetchWithTimeout(u, {
        redirect: "manual",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
          "Accept-Language": "en-US,en;q=0.9",
        },
      }, FETCH_TIMEOUT_MS);
    } catch {
      throw new JobError(422, "timeout_or_blocked", "The website took too long to respond or blocked the request.");
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, u).toString();
      continue;
    }
    if (!res.ok) throw new JobError(422, "upstream_error", `The website responded with an error (${res.status}).`);
    const ct = res.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml|text\/plain/i.test(ct)) {
      throw new JobError(422, "not_a_page", "That link isn't a web page.");
    }
    return readCapped(res);
  }
  throw new JobError(422, "too_many_redirects", "Too many redirects.");
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

function asTextLocal(value: unknown): string {
  if (typeof value === "string") return htmlToTextLocal(value);
  if (Array.isArray(value)) return value.map(asTextLocal).filter(Boolean).join("\n");
  if (value && typeof value === "object") {
    const o = value as Json;
    if (typeof o.name === "string") return o.name;
    if (typeof o.description === "string") return htmlToTextLocal(o.description);
  }
  return "";
}

function metaLocal(html: string, prop: string): string {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decodeEntitiesLocal(content).trim() : "";
}

function extractLocal(html: string): { title: string; company: string; text: string } {
  const ldBlocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of ldBlocks) {
    try {
      const job = findJobPosting(JSON.parse(block[1].trim()));
      if (job && job.description) {
        const title = asTextLocal(job.title);
        const company = asTextLocal(job.hiringOrganization);
        const section = (label: string, value: unknown) => {
          const t = asTextLocal(value);
          return t ? `\n${label}:\n${t}` : "";
        };
        const location = asTextLocal(job.jobLocation);
        const parts: string[] = [
          title ? `Job title: ${title}` : "",
          company ? `Company: ${company}` : "",
          location ? `Location: ${location}` : "",
          "",
          asTextLocal(job.description),
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

  const rawTitle = metaLocal(html, "og:title") || decodeEntitiesLocal(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
  const company = metaLocal(html, "og:site_name");
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html.match(/<article[\s\S]*?<\/article>/i)?.[0];
  const stripped = (main && htmlToTextLocal(main).length > 400 ? main : html).replace(
    /<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi,
    " ",
  );
  return { title: rawTitle, company, text: htmlToTextLocal(stripped) };
}

export default async function handler(req: Req, res: ServerResponse) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return send(res, 405, { error: "Method not allowed", code: "method_not_allowed" });
    }
    if (!originAllowed(req)) return send(res, 403, { error: "Request not allowed.", code: "forbidden" });
    if (!rateLimit(req, res, 20)) return;

    let body: unknown;
    try {
      body = await readRequestBody(req, 50_000);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message, code: err.code });
      return send(res, 400, { error: "Invalid request body.", code: "bad_request" });
    }
    if (!isObj(body)) return send(res, 400, { error: "Invalid request.", code: "bad_request" });

    const url = typeof (body as Record<string, unknown>).url === "string"
      ? (body as Record<string, unknown>).url.trim()
      : "";
    if (!url) throw new JobError(400, "missing_url", "Please provide a job link.");

    const html = await fetchPage(url);
    const { title, company, text } = extractLocal(html);
    if (text.length < 300) {
      throw new JobError(
        422,
        "extraction_failed",
        "Couldn't read a job description from that page (it may need a login or load with JavaScript). Please paste the job text instead.",
      );
    }
    return send(res, 200, { title, company, text: text.slice(0, MAX_CHARS) });
  } catch (err) {
    if (err instanceof JobError) return send(res, err.status, { error: err.message, code: err.code });
    if (err instanceof HttpError) return send(res, err.status, { error: err.message, code: err.code });
    return send(res, 500, { error: "Something went wrong while reading that page.", code: "internal_error" });
  }
}
