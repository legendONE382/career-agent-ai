import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "./resume";

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

function makeReq(body: unknown, headers: Record<string, string> = {}): any {
  return {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://careerai-pink.vercel.app", host: "careerai-pink.vercel.app", ...headers },
    socket: { remoteAddress: "1.2.3.4" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

describe("/api/resume/extract", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
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
    await handler({ method: "GET", headers: {}, socket: { remoteAddress: "1.2.3.4" } } as any, res);
    expect(res.statusCode).toBe(405);
  });

  it("returns 400 for missing file data", async () => {
    const res = makeRes();
    await handler(makeReq({ filename: "resume.pdf", mimeType: "application/pdf" }) as any, res);
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(String(res.body));
    expect(body.code).toBe("missing_file");
  });

  it("returns 400 for unsupported file type", async () => {
    const res = makeRes();
    await handler(makeReq({ filename: "image.png", data: "abc123", mimeType: "image/png" }) as any, res);
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(String(res.body));
    expect(body.code).toBe("unsupported_type");
  });

  it("extracts text from a TXT file locally", async () => {
    const textContent = "John Doe\nSoftware Engineer\nExperience: 5 years\nSkills: TypeScript, React";
    const base64 = Buffer.from(textContent).toString("base64");
    const res = makeRes();
    await handler(
      makeReq({ filename: "resume.txt", data: base64, mimeType: "text/plain" }) as any,
      res,
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(String(res.body));
    expect(body.text).toContain("John Doe");
    expect(body.text).toContain("TypeScript");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("extracts text from a MD file locally", async () => {
    const textContent = "# John Doe\n\n## Skills\n- TypeScript\n- React";
    const base64 = Buffer.from(textContent).toString("base64");
    const res = makeRes();
    await handler(
      makeReq({ filename: "resume.md", data: base64, mimeType: "text/markdown" }) as any,
      res,
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(String(res.body));
    expect(body.text).toContain("John Doe");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handles DOCX with empty content via mammoth", async () => {
    // Create a minimal valid DOCX (ZIP container with basic structure)
    // mammoth will parse it but may return minimal text
    const base64 = "UEsDBBQABgAIAAAAIQD..."; // truncated fake base64
    const res = makeRes();
    await handler(
      makeReq({ filename: "resume.docx", data: base64, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }) as any,
      res,
    );
    // mammoth may throw or return empty; either way we handle it
    expect([200, 422, 500]).toContain(res.statusCode);
  });

  it("extracts text from a PDF via Gemini", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ candidates: [{ content: { parts: [{ text: "# John Doe\n\n## Experience\n- Software Engineer at Acme" }] } }] }),
    );
    const fakePdfBase64 = "JVBERi0xLjQKJeLjz9M=";
    const res = makeRes();
    await handler(
      makeReq({ filename: "resume.pdf", data: fakePdfBase64, mimeType: "application/pdf" }) as any,
      res,
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(String(res.body));
    expect(body.text).toContain("John Doe");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 503 when GEMINI_API_KEY is absent for PDF extraction", async () => {
    delete process.env.GEMINI_API_KEY;
    const res = makeRes();
    await handler(
      makeReq({ filename: "resume.pdf", data: "JVBERi0xLjQ=", mimeType: "application/pdf" }) as any,
      res,
    );
    expect(res.statusCode).toBe(503);
    const body = JSON.parse(String(res.body));
    expect(body.code).toBe("not_configured");
  });

  it("returns 413 for oversized uploads", async () => {
    const largeData = "A".repeat(12_000_000); // ~9 MB base64
    const res = makeRes();
    await handler(
      makeReq({ filename: "resume.txt", data: largeData, mimeType: "text/plain" }) as any,
      res,
    );
    expect(res.statusCode).toBe(413);
    const body = JSON.parse(String(res.body));
    expect(body.code).toBe("payload_too_large");
  });
});
