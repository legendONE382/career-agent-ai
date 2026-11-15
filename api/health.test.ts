import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "./health";

function makeRes() {
  const headers: Record<string, string> = {};
  let status = 200;
  let body: unknown = null;
  const res = {
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
  } as unknown as {
    setHeader: (k: string, v: string) => void;
    statusCode: number;
    end: (c: unknown) => void;
    headers: Record<string, string>;
    body: unknown;
  };
  (res as any).body = body;
  const origEnd = res.end;
  res.end = ((content: unknown) => {
    (res as any).body = content;
    origEnd(content);
  }) as any;
  return res;
}

function jsonBody(value: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    async text() {
      return JSON.stringify(value);
    },
    async json() {
      return value;
    },
  } as unknown as Response;
}

describe("/api/health", () => {
  const origFetch = globalThis.fetch;
  let fetchMock: any;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.stubGlobal("fetch", origFetch);
    vi.restoreAllMocks();
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
  });

  it("reports not_configured when no key is set", async () => {
    const res = makeRes();
    await handler({} as any, res);
    expect(fetchMock).not.toHaveBeenCalled();
    const body = JSON.parse((res as any).body as string);
    expect(body.configured).toBe(false);
    expect(body.status).toBe("not_configured");
    expect(body.ok).toBe(false);
  });

  it("reports operational when key works and model is available", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_MODEL = "gemini-flash-latest";
    fetchMock.mockResolvedValue(
      jsonBody({ models: [{ name: "models/gemini-flash-latest" }, { name: "models/gemini-pro" }] }),
    );
    const res = makeRes();
    await handler({} as any, res);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((res as any).body as string);
    expect(body.configured).toBe(true);
    expect(body.status).toBe("operational");
    expect(body.ok).toBe(true);
    expect(body.model).toBe("gemini-flash-latest");
  });

  it("reports invalid_key on 401/403", async () => {
    process.env.GEMINI_API_KEY = "bad-key";
    fetchMock.mockResolvedValue(jsonBody({ error: { message: "API key invalid" } }, 401));
    const res = makeRes();
    await handler({} as any, res);
    const body = JSON.parse((res as any).body as string);
    expect(body.status).toBe("invalid_key");
    expect(body.configured).toBe(false);
    expect(body.ok).toBe(false);
  });

  it("reports quota_exhausted on 429", async () => {
    process.env.GEMINI_API_KEY = "key";
    fetchMock.mockResolvedValue(jsonBody({ error: { message: "quota" } }, 429));
    const res = makeRes();
    await handler({} as any, res);
    const body = JSON.parse((res as any).body as string);
    expect(body.status).toBe("quota_exhausted");
    expect(body.ok).toBe(false);
  });

  it("reports model_unavailable when the configured model is missing", async () => {
    process.env.GEMINI_API_KEY = "key";
    process.env.GEMINI_MODEL = "gemini-3.8-flash";
    fetchMock.mockResolvedValue(jsonBody({ models: [{ name: "models/gemini-flash-latest" }] }));
    const res = makeRes();
    await handler({} as any, res);
    const body = JSON.parse((res as any).body as string);
    expect(body.status).toBe("model_unavailable");
    expect(body.ok).toBe(false);
    expect(body.model).toBe("gemini-3.8-flash");
  });

  it("reports upstream_failure when fetch throws", async () => {
    process.env.GEMINI_API_KEY = "key";
    fetchMock.mockRejectedValue(new Error("ENOTFOUND"));
    const res = makeRes();
    await handler({} as any, res);
    const body = JSON.parse((res as any).body as string);
    expect(body.status).toBe("upstream_failure");
    expect(body.ok).toBe(false);
  });

  it("reports upstream_failure on non-JSON / non-ok upstream", async () => {
    process.env.GEMINI_API_KEY = "key";
    fetchMock.mockResolvedValue(
      jsonBody({ error: { message: "internal" } }, 500),
    );
    const res = makeRes();
    await handler({} as any, res);
    const body = JSON.parse((res as any).body as string);
    expect(body.status).toBe("upstream_failure");
    expect(body.ok).toBe(false);
  });
});
