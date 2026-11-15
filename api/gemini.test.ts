import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function makeReq(method: string, headers: Record<string, string> = {}): any {
  return {
    method,
    headers: { "content-type": "application/json", origin: "https://careerai-pink.vercel.app", host: "careerai-pink.vercel.app", ...headers },
    socket: { remoteAddress: "1.2.3.4" },
  };
}

const origFetch = globalThis.fetch;
const origSetTimeout = globalThis.setTimeout;
const origEnv = process.env.GEMINI_API_KEY;
const origModel = process.env.GEMINI_MODEL;

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    async text() {
      return JSON.stringify(data);
    },
    async json() {
      return data;
    },
  } as unknown as Response;
}

describe("/api/gemini", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // Mock setTimeout to resolve instantly to avoid retry delays in tests
    vi.stubGlobal("setTimeout", (cb: () => void) => {
      cb();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });
    process.env.GEMINI_API_KEY = origEnv ?? "test-key";
    process.env.GEMINI_MODEL = origModel ?? "gemini-flash-latest";
  });

  afterEach(() => {
    vi.stubGlobal("fetch", origFetch);
    vi.stubGlobal("setTimeout", origSetTimeout);
    vi.restoreAllMocks();
    if (origEnv === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = origEnv;
    if (origModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = origModel;
  });

  it("rejects non-POST methods", async () => {
    const res = makeRes();
    await handler(makeReq("GET") as any, res);
    expect(res.statusCode).toBe(405);
    expect(res.headers["allow"]).toBe("POST");
    expect(JSON.parse(String(res.body)).code).toBe("method_not_allowed");
  });

  it("returns 503 not_configured when GEMINI_API_KEY is absent", async () => {
    delete process.env.GEMINI_API_KEY;
    const res = makeRes();
    await handler(makeReq("POST") as any, res);
    expect(res.statusCode).toBe(503);
    const body = JSON.parse(String(res.body));
    expect(body.code).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid payload", async () => {
    const res = makeRes();
    const rawReq = makeReq("POST");
    rawReq.body = JSON.stringify({ contents: "not an array" });
    await handler(rawReq, res);
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(String(res.body));
    expect(body.code).toBe("bad_request");
  });

  it("successfully proxies a valid generateContent request", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ candidates: [{ content: { parts: [{ text: "Hello there!" }] } }] }),
    );
    const res = makeRes();
    const rawReq = makeReq("POST");
    rawReq.body = JSON.stringify({ contents: [{ parts: [{ text: "Say hello" }] }] });
    await handler(rawReq, res);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(String(res.body));
    expect(body.text).toBe("Hello there!");
    // Verify the API key was sent in the header, not in the URL
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("gemini-flash-latest:generateContent"),
      expect.objectContaining({
        headers: expect.objectContaining({ "x-goog-api-key": "test-key" }),
      }),
    );
    // Verify the key is NOT in the URL
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).not.toContain("test-key");
    expect(url).not.toContain("key=");
  });

  it("returns invalid_key on 401/403 from upstream", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: "API key invalid" } }, 401));
    const res = makeRes();
    const rawReq = makeReq("POST");
    rawReq.body = JSON.stringify({ contents: [{ parts: [{ text: "hi" }] }] });
    await handler(rawReq, res);
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(String(res.body));
    expect(body.code).toBe("invalid_key");
  });

  it("returns quota_exhausted on 429 from upstream", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: "quota" } }, 429));
    const res = makeRes();
    const rawReq = makeReq("POST");
    rawReq.body = JSON.stringify({ contents: [{ parts: [{ text: "hi" }] }] });
    await handler(rawReq, res);
    expect(res.statusCode).toBe(429);
    const body = JSON.parse(String(res.body));
    expect(body.code).toBe("quota_exhausted");
  });

  it("returns model_unavailable on 404 from upstream", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: "not found" } }, 404));
    const res = makeRes();
    const rawReq = makeReq("POST");
    rawReq.body = JSON.stringify({ contents: [{ parts: [{ text: "hi" }] }] });
    await handler(rawReq, res);
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(String(res.body));
    expect(body.code).toBe("model_unavailable");
  });

  it("handles upstream network failure", async () => {
    fetchMock.mockRejectedValue(new Error("ENOTFOUND"));
    const res = makeRes();
    const rawReq = makeReq("POST");
    rawReq.body = JSON.stringify({ contents: [{ parts: [{ text: "hi" }] }] });
    await handler(rawReq, res);
    expect(res.statusCode).toBe(502);
    const body = JSON.parse(String(res.body));
    expect(body.code).toBe("upstream_failure");
  });

  it("handles malformed JSON response from upstream", async () => {
    const badResp = {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      async text() {
        return "not valid json";
      },
      async json() {
        throw new Error("not json");
      },
    } as unknown as Response;
    fetchMock.mockResolvedValue(badResp);
    const res = makeRes();
    const rawReq = makeReq("POST");
    rawReq.body = JSON.stringify({ contents: [{ parts: [{ text: "hi" }] }] });
    await handler(rawReq, res);
    expect(res.statusCode).toBe(502);
    const body = JSON.parse(String(res.body));
    expect(body.code).toBe("bad_response");
  });
});
