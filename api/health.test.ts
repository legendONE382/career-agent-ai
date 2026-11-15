import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "./health";

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

const origFetch = globalThis.fetch;
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

describe("/api/health", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
  });

  afterEach(() => {
    vi.stubGlobal("fetch", origFetch);
    vi.restoreAllMocks();
    if (origEnv === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = origEnv;
    if (origModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = origModel;
  });

  it("reports not_configured when no key is set", async () => {
    const res = makeRes();
    await handler({} as any, res);
    expect(fetchMock).not.toHaveBeenCalled();
    const body = JSON.parse(String(res.body));
    expect(body.configured).toBe(false);
    expect(body.status).toBe("not_configured");
    expect(body.ok).toBe(false);
    expect(body.message).toContain("not set");
  });

  it("reports operational when key works and model is available", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_MODEL = "gemini-flash-latest";
    fetchMock.mockResolvedValue(
      jsonResponse({ models: [{ name: "models/gemini-flash-latest" }, { name: "models/gemini-pro" }] }),
    );
    const res = makeRes();
    await handler({} as any, res);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(res.body));
    expect(body.configured).toBe(true);
    expect(body.status).toBe("operational");
    expect(body.ok).toBe(true);
    expect(body.model).toBe("gemini-flash-latest");
  });

  it("reports invalid_key on 401/403", async () => {
    process.env.GEMINI_API_KEY = "bad-key";
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: "API key invalid" } }, 401));
    const res = makeRes();
    await handler({} as any, res);
    const body = JSON.parse(String(res.body));
    expect(body.status).toBe("invalid_key");
    expect(body.configured).toBe(false);
    expect(body.ok).toBe(false);
  });

  it("reports quota_exhausted on 429", async () => {
    process.env.GEMINI_API_KEY = "key";
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: "quota" } }, 429));
    const res = makeRes();
    await handler({} as any, res);
    const body = JSON.parse(String(res.body));
    expect(body.status).toBe("quota_exhausted");
    expect(body.ok).toBe(false);
  });

  it("reports model_unavailable when the configured model is missing", async () => {
    process.env.GEMINI_API_KEY = "key";
    process.env.GEMINI_MODEL = "gemini-3.8-flash";
    fetchMock.mockResolvedValue(jsonResponse({ models: [{ name: "models/gemini-flash-latest" }] }));
    const res = makeRes();
    await handler({} as any, res);
    const body = JSON.parse(String(res.body));
    expect(body.status).toBe("model_unavailable");
    expect(body.ok).toBe(false);
    expect(body.model).toBe("gemini-3.8-flash");
  });

  it("reports upstream_failure when fetch throws", async () => {
    process.env.GEMINI_API_KEY = "key";
    fetchMock.mockRejectedValue(new Error("ENOTFOUND"));
    const res = makeRes();
    await handler({} as any, res);
    const body = JSON.parse(String(res.body));
    expect(body.status).toBe("upstream_failure");
    expect(body.ok).toBe(false);
  });

  it("reports upstream_failure on non-ok upstream", async () => {
    process.env.GEMINI_API_KEY = "key";
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: "internal" } }, 500));
    const res = makeRes();
    await handler({} as any, res);
    const body = JSON.parse(String(res.body));
    expect(body.status).toBe("upstream_failure");
    expect(body.ok).toBe(false);
  });
});
