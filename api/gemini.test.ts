import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "./gemini";

function makeRes() {
  const headers: Record<string, string> = {};
  let status = 200;
  let body: unknown = null;
  const res = {
    headers,
    setHeader: (k: string, v: string) => {
      headers[k.toLowerCase()] = String(v);
    },
    get statusCode() {
      return status;
    },
    set statusCode(v: number) {
      status = v;
    },
    end: (content: unknown) => {
      body = content;
    },
    get body() {
      return body;
    },
  } as unknown as {
    headers: Record<string, string>;
    setHeader: (k: string, v: string) => void;
    statusCode: number;
    end: (c: unknown) => void;
    body: unknown;
  };
  return res;
}

function makeReq(method: string, headers: Record<string, string> = {}): { method: string; headers: Record<string, string>; socket: { remoteAddress: string } } {
  return { method, headers, socket: { remoteAddress: "1.2.3.4" } } as any;
}

describe("/api/gemini", () => {
  const origEnv = process.env.GEMINI_API_KEY;
  afterEach(() => {
    if (origEnv === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = origEnv;
    vi.restoreAllMocks();
  });

  it("rejects non-POST methods", async () => {
    const res = makeRes();
    await handler(makeReq("GET") as any, res);
    expect(res.statusCode).toBe(405);
    expect(res.headers["allow"]).toBe("POST");
    expect(JSON.parse(String(res.body)).error).toBe("Method not allowed.");
  });

  it("returns 503 not_configured when GEMINI_API_KEY is absent", async () => {
    delete process.env.GEMINI_API_KEY;
    const res = makeRes();
    await handler(makeReq("POST") as any, res);
    expect(res.statusCode).toBe(503);
    const body = JSON.parse(String(res.body));
    expect(body.code).toBe("not_configured");
  });
});
