import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { originAllowed, rateLimit, type Req } from "../api/_lib";

function makeReq(headers: Record<string, string | string[] | undefined> = {}): Req {
  return {
    headers,
    socket: { remoteAddress: "1.2.3.4" },
  } as unknown as Req;
}

function makeRes() {
  const headers: Record<string, string> = {};
  const res = {
    headers,
    setHeader: (k: string, v: string) => {
      headers[k.toLowerCase()] = String(v);
    },
    statusCode: 200,
    end: () => {},
  };
  return res as unknown as { setHeader: (k: string, v: string) => void; statusCode: number; headers: Record<string, string> };
}

describe("originAllowed", () => {
  it("allows requests without an origin header", () => {
    expect(originAllowed(makeReq({}))).toBe(true);
  });

  it("allows same-origin requests", () => {
    expect(originAllowed(makeReq({ origin: "https://careerai-pink.vercel.app", host: "careerai-pink.vercel.app" }))).toBe(true);
  });

  it("rejects cross-origin requests", () => {
    expect(originAllowed(makeReq({ origin: "https://evil.com", host: "careerai-pink.vercel.app" }))).toBe(false);
  });

  it("rejects malformed origins", () => {
    expect(originAllowed(makeReq({ origin: "not-a-url", host: "x.com" }))).toBe(false);
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
