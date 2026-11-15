import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import handler from "./job";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

const lookupMock = vi.mocked(lookup);

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

function htmlResponse(html: string, status = 200, ct = "text/html") {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": ct }),
    async text() {
      return html;
    },
  } as unknown as Response;
}

describe("/api/job", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });

  afterEach(() => {
    vi.stubGlobal("fetch", origFetch);
    vi.restoreAllMocks();
    lookupMock.mockReset();
  });

  function makeReq(body: unknown, headers: Record<string, string> = {}): any {
    return {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://careerai-pink.vercel.app", host: "careerai-pink.vercel.app", ...headers },
      socket: { remoteAddress: "1.2.3.4" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    };
  }

  it("rejects non-POST methods", async () => {
    const res = makeRes();
    await handler({ method: "GET", headers: {}, socket: { remoteAddress: "1.2.3.4" } } as any, res);
    expect(res.statusCode).toBe(405);
  });

  it("returns 400 for missing URL", async () => {
    const res = makeRes();
    await handler(makeReq({}) as any, res);
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(String(res.body));
    expect(body.code).toBe("missing_url");
  });

  it("returns 400 for private IP addresses (SSRF)", async () => {
    const res = makeRes();
    await handler(makeReq({ url: "http://127.0.0.1/" }) as any, res);
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(String(res.body));
    expect(body.code).toBe("blocked_address");
  });

  it("returns 400 for localhost", async () => {
    const res = makeRes();
    await handler(makeReq({ url: "http://localhost/" }) as any, res);
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(String(res.body));
    expect(body.code).toBe("blocked_address");
  });

  it("returns 400 for non-http(s) protocols", async () => {
    const res = makeRes();
    await handler(makeReq({ url: "ftp://example.com/" }) as any, res);
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(String(res.body));
    expect(body.code).toBe("invalid_protocol");
  });

  it("extracts job from JSON-LD", async () => {
    const html = `
      <html><body>
        <script type="application/ld+json">
        {"@type":"JobPosting","title":"Senior Software Engineer","hiringOrganization":{"name":"Acme Corporation"},"jobLocation":"New York, NY","description":"We are seeking a Senior Software Engineer to join our growing engineering team. You will be responsible for designing, developing, and maintaining scalable web applications using modern technologies. The ideal candidate has 5+ years of experience with TypeScript, React, and Node.js. You will collaborate with product managers, designers, and other engineers to deliver high-quality software solutions.","qualifications":"Bachelor's degree in Computer Science or related field. 5+ years of professional software development experience. Proficiency in TypeScript, React, Node.js, and REST APIs. Experience with cloud platforms (AWS, GCP, or Azure). Strong problem-solving and communication skills.","skills":"TypeScript, React, Node.js, REST APIs, AWS, Git, Docker","experienceRequirements":"5+ years","responsibilities":"Design and develop scalable web applications. Collaborate with cross-functional teams. Write clean, maintainable, and well-tested code. Participate in code reviews and agile ceremonies. Mentor junior engineers."}
        </script>
      </body></html>
    `;
    fetchMock.mockResolvedValue(htmlResponse(html));
    const res = makeRes();
    await handler(makeReq({ url: "https://example.com/job" }) as any, res);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(String(res.body));
    expect(body.title).toContain("Senior Software Engineer");
    expect(body.company).toContain("Acme Corporation");
    expect(body.text).toContain("scalable web applications");
  });

  it("extracts job from Open Graph metadata", async () => {
    const html = `
      <html><head>
        <meta property="og:title" content="Product Manager">
        <meta property="og:site_name" content="TechCo">
      </head><body><article>We are hiring a product manager to lead our product team. You will be responsible for defining product strategy, working with engineering and design teams, and delivering products that customers love. The ideal candidate has 3+ years of product management experience and a passion for building great user experiences.</article></body></html>
    `;
    fetchMock.mockResolvedValue(htmlResponse(html));
    const res = makeRes();
    await handler(makeReq({ url: "https://example.com/job" }) as any, res);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(String(res.body));
    expect(body.title).toContain("Product Manager");
    expect(body.company).toContain("TechCo");
  });

  it("returns 422 for pages with insufficient content", async () => {
    fetchMock.mockResolvedValue(htmlResponse("<html><body>Hi</body></html>"));
    const res = makeRes();
    await handler(makeReq({ url: "https://example.com/job" }) as any, res);
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(String(res.body));
    expect(body.code).toBe("extraction_failed");
  });

  it("returns 422 for DNS resolution failure", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    const res = makeRes();
    await handler(makeReq({ url: "https://nonexistent-example-domain-12345.com/" }) as any, res);
    expect(res.statusCode).toBe(422);
  });
});
