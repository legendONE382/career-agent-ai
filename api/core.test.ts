import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import {
  isPrivateIPv4,
  isPrivateIp,
  parseIPv6,
  assertPublicUrl,
  htmlToText,
  decodeEntities,
  rateLimit,
  send,
  type Req,
} from "./core";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

const lookupMock = vi.mocked(lookup);

// Helper to create a mock request
function makeReq(headers: Record<string, string | string[] | undefined> = {}): Req {
  return {
    headers: headers as IncomingMessage["headers"],
    socket: { remoteAddress: "1.2.3.4" },
  } as unknown as Req;
}

// Helper to create a mock response
function makeRes() {
  const headers: Record<string, string> = {};
  const res = {
    headers,
    setHeader: (k: string, v: string) => {
      headers[k.toLowerCase()] = String(v);
    },
    statusCode: 200,
    end: () => {},
  } as unknown as {
    headers: Record<string, string>;
    setHeader: (k: string, v: string) => void;
    statusCode: number;
    end: () => void;
  };
  return res;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_MODEL;
});

async function expectHttpError(fn: () => Promise<unknown>, code: string, status?: number) {
  try {
    await fn();
    throw new Error("Expected function to throw");
  } catch (e: any) {
    expect(e.code).toBe(code);
    if (status !== undefined) expect(e.status).toBe(status);
  }
}

describe("isPrivateIPv4 (SSRF protection)", () => {
  it("rejects private IPv4 ranges", () => {
    expect(isPrivateIPv4("10.0.0.1")).toBe(true);
    expect(isPrivateIPv4("127.0.0.1")).toBe(true);
    expect(isPrivateIPv4("172.16.0.1")).toBe(true);
    expect(isPrivateIPv4("192.168.1.1")).toBe(true);
    expect(isPrivateIPv4("100.64.0.1")).toBe(true);
    expect(isPrivateIPv4("169.254.0.1")).toBe(true);
    expect(isPrivateIPv4("224.0.0.1")).toBe(true);
    expect(isPrivateIPv4("0.0.0.0")).toBe(true);
  });

  it("allows public IPv4", () => {
    expect(isPrivateIPv4("8.8.8.8")).toBe(false);
    expect(isPrivateIPv4("1.1.1.1")).toBe(false);
    expect(isPrivateIPv4("93.184.216.34")).toBe(false);
  });

  it("treats invalid input as unsafe", () => {
    expect(isPrivateIPv4("not an ip")).toBe(true);
    expect(isPrivateIPv4("")).toBe(true);
    expect(isPrivateIPv4("1.2.3")).toBe(true);
  });
});

describe("isPrivateIp (SSRF protection)", () => {
  it("rejects private IPv6", () => {
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("fc00::1")).toBe(true);
    expect(isPrivateIp("::ffff:192.168.1.1")).toBe(true);
    expect(isPrivateIp("::ffff:8.8.8.8")).toBe(false);
  });

  it("allows public IPv4", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false);
  });

  it("rejects non-IP input", () => {
    expect(isPrivateIp("not an ip")).toBe(true);
    expect(isPrivateIp("")).toBe(true);
  });
});

describe("parseIPv6", () => {
  it("parses full IPv6 addresses", () => {
    const result = parseIPv6("2001:0db8:85a3:0000:0000:8a2e:0370:7334");
    expect(result).toHaveLength(8);
    expect(result?.[0]).toBe(0x2001);
  });

  it("parses compressed IPv6 with ::", () => {
    const result = parseIPv6("::1");
    expect(result).toHaveLength(8);
    expect(result?.[7]).toBe(1);
  });

  it("rejects malformed IPv6", () => {
    expect(parseIPv6("not an ip")).toBeNull();
    expect(parseIPv6("")).toBeNull();
  });
});

describe("htmlToText", () => {
  it("strips scripts, styles and converts lists/breaks", () => {
    const html = "<html><script>alert('x')</script><style>body{}</style><body><h1>Title</h1><ul><li>one</li><li>two</li></ul><p>para<br/>break</p></body></html>";
    const text = htmlToText(html);
    expect(text).not.toContain("alert");
    expect(text).not.toContain("script");
    expect(text).not.toContain("style");
    expect(text).toContain("Title");
    expect(text).toContain("• one");
    expect(text).toContain("• two");
    expect(text).toContain("para");
  });

  it("decodes html entities", () => {
    expect(htmlToText("<p>At&amp;t &lt;Co&gt;</p>")).toContain("At&t <Co>");
    expect(htmlToText("a&nbsp;b")).toContain("a b");
  });

  it("returns empty string for empty input", () => {
    expect(htmlToText("")).toBe("");
  });
});

describe("decodeEntities", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeEntities("&amp;")).toBe("&");
    expect(decodeEntities("&#65;")).toBe("A");
    expect(decodeEntities("&#x41;")).toBe("A");
    expect(decodeEntities("&nbsp;")).toBe(" ");
  });
});

describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under the limit", () => {
    vi.setSystemTime(1000);
    const res = makeRes();
    expect(rateLimit(makeReq({ "x-forwarded-for": "1.1.1.1" }), res, 3)).toBe(true);
    expect(rateLimit(makeReq({ "x-forwarded-for": "1.1.1.1" }), res, 3)).toBe(true);
    expect(rateLimit(makeReq({ "x-forwarded-for": "1.1.1.1" }), res, 3)).toBe(true);
  });

  it("blocks requests over the limit", () => {
    vi.setSystemTime(1000);
    const res = makeRes();
    rateLimit(makeReq({ "x-forwarded-for": "2.2.2.2" }), res, 2);
    rateLimit(makeReq({ "x-forwarded-for": "2.2.2.2" }), res, 2);
    const allowed = rateLimit(makeReq({ "x-forwarded-for": "2.2.2.2" }), res, 2);
    expect(allowed).toBe(false);
    expect(res.headers["retry-after"]).toBe("60");
  });

  it("resets after the window expires", () => {
    vi.setSystemTime(1000);
    const res = makeRes();
    rateLimit(makeReq({ "x-forwarded-for": "3.3.3.3" }), res, 1);
    rateLimit(makeReq({ "x-forwarded-for": "3.3.3.3" }), res, 1);
    vi.setSystemTime(1000 + 10 * 60_000 + 1);
    const res2 = makeRes();
    expect(rateLimit(makeReq({ "x-forwarded-for": "3.3.3.3" }), res2, 1)).toBe(true);
  });
});

describe("assertPublicUrl (SSRF)", () => {
  beforeEach(() => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });

  it("rejects private IP addresses directly", async () => {
    await expectHttpError(() => assertPublicUrl("http://127.0.0.1/"), "blocked_address", 400);
    await expectHttpError(() => assertPublicUrl("http://10.0.0.1/"), "blocked_address", 400);
    await expectHttpError(() => assertPublicUrl("http://192.168.1.1/"), "blocked_address", 400);
    await expectHttpError(() => assertPublicUrl("http://localhost/"), "blocked_address", 400);
  });

  it("rejects non-http(s) protocols", async () => {
    await expectHttpError(() => assertPublicUrl("ftp://example.com/"), "invalid_protocol", 400);
    await expectHttpError(() => assertPublicUrl("file:///etc/passwd"), "invalid_protocol", 400);
  });

  it("rejects invalid URLs", async () => {
    await expectHttpError(() => assertPublicUrl("not a url"), "invalid_url", 400);
  });

  it("rejects DNS resolution failure", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    await expectHttpError(() => assertPublicUrl("https://nonexistent-domain-xyz123.com/"), "dns_failure", 422);
  });
});

describe("send helper", () => {
  it("sets status, content-type, and cache-control headers", () => {
    const res = makeRes();
    send(res, 201, { ok: true });
    expect(res.statusCode).toBe(201);
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
