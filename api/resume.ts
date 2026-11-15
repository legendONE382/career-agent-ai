/**
 * Vercel Serverless Function — resume/CV extraction.
 *
 * POST /api/resume/extract
 * Body: { filename: string, data: string (base64), mimeType: string }
 *
 * Extracts text from PDF, DOCX, TXT, and MD files.
 *   - PDF: forwarded to Gemini for high-fidelity extraction (structure preserved)
 *   - DOCX: extracted locally via mammoth (no external API call)
 *   - TXT/MD: read directly (no external API call)
 *
 * Never stores the document. Returns only extracted text.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { send, readRequestBody, isObj, HttpError, rateLimit, originAllowed, fetchWithTimeout, type GeminiError, isGeminiError } from "./core";
import mammoth from "mammoth";

const MAX_FILE_BYTES = 8_000_000; // 8 MB cap for uploads
const PDF_EXTRACT_PROMPT = `Extract the complete text content of this resume/CV. Preserve the document structure:

- Full name and contact information
- Professional summary or objective
- Technical skills (grouped by category)
- Work experience (company, role, dates, bullet points for achievements)
- Projects (name, description, technologies)
- Education (degree, institution, dates)
- Certifications and qualifications

Return ONLY the extracted text in markdown format. Use headings (##) for sections and bullet points (-) for lists. Do not invent any information not present in the document. If a section is missing, omit it rather than fabricating content.`;

type ExtractRequest = {
  filename?: unknown;
  data?: unknown;
  mimeType?: unknown;
};

function isValidMimeType(mime: string): boolean {
  const lower = mime.toLowerCase().trim();
  return (
    lower === "application/pdf" ||
    lower === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower === "application/msword" ||
    lower === "text/plain" ||
    lower === "text/markdown" ||
    lower === "text/x-markdown"
  );
}

function fileExtFromMime(mime: string): string {
  const lower = mime.toLowerCase().trim();
  if (lower === "application/pdf") return ".pdf";
  if (lower.includes("wordprocessingml") || lower === "application/msword") return ".docx";
  if (lower === "text/markdown" || lower === "text/x-markdown") return ".md";
  return ".txt";
}

async function extractDocx(dataBase64: string): Promise<string> {
  const buf = Buffer.from(dataBase64, "base64");
  const result = await mammoth.extractRawText({ buffer: buf });
  const text = result.value || "";
  if (text.trim().length < 30) {
    throw new HttpError(422, "empty_extraction", "Couldn't find readable text in that Word document. Paste your resume text instead.");
  }
  return text.trim();
}

async function extractTextFile(dataBase64: string): Promise<string> {
  const buf = Buffer.from(dataBase64, "base64");
  const text = buf.toString("utf8");
  if (text.trim().length < 30) {
    throw new HttpError(422, "empty_extraction", "The file appears to be empty or contains no readable text. Paste your resume text instead.");
  }
  return text.trim();
}

async function extractPdfViaGemini(dataBase64: string): Promise<string> {
  const key = (process.env.GEMINI_API_KEY || "").trim();
  const model = (process.env.GEMINI_MODEL || "gemini-flash-latest").trim();
  if (!key) {
    throw new HttpError(503, "not_configured", "AI unavailable for PDF extraction.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "application/pdf", data: dataBase64 } },
          { text: PDF_EXTRACT_PROMPT },
        ],
      },
    ],
    generationConfig: {
      maxOutputTokens: 8192,
      temperature: 0.1,
    },
  };

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const upstream = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(payload),
      }, 55_000);

      const raw = await upstream.text();
      if (!upstream.ok) {
        const mapped = mapGeminiHttpErrorSimple(upstream.status, raw);
        if ((mapped.code === "quota_exhausted" || mapped.code === "upstream_failure") && attempt < 2) {
          await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
          continue;
        }
        throw new HttpError(upstream.status, mapped.code, mapped.message);
      }

      let data: unknown = null;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new HttpError(502, "bad_response", "The AI returned an unreadable response.");
      }

      const text = extractGeminiText(data);
      if (text.trim().length < 30) {
        throw new HttpError(422, "empty_extraction", "Couldn't extract readable text from that PDF. Paste your resume text instead.");
      }
      return text.trim();
    } catch (err) {
      if (err instanceof HttpError) {
        lastError = err;
        if (attempt < 2 && (err.code === "quota_exhausted" || err.code === "upstream_failure" || err.code === "timeout")) {
          await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
          continue;
        }
        throw err;
      }
      lastError = err;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
        continue;
      }
      throw new HttpError(502, "upstream_failure", "PDF extraction failed. Please try again or paste your resume text.");
    }
    throw lastError ?? new HttpError(500, "internal_error", "PDF extraction failed.");
  }
  throw lastError ?? new HttpError(500, "internal_error", "PDF extraction failed.");
}

function mapGeminiHttpErrorSimple(status: number, raw: string): { code: string; message: string } {
  let message = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  switch (status) {
    case 401: case 403: return { code: "invalid_key", message: "Gemini API key is invalid or unauthorized." };
    case 404: return { code: "model_unavailable", message: "The configured Gemini model is not available." };
    case 429: return { code: "quota_exhausted", message: "Gemini API quota has been exhausted." };
    case 502: case 503: return { code: "upstream_failure", message: "Gemini service is temporarily unavailable." };
    case 504: return { code: "timeout", message: "Gemini request timed out." };
    default: return { code: "upstream_failure", message: `Gemini API returned an error (${status}).` };
  }
}

interface GeminiCandidate {
  finishReason?: string;
  content?: { parts?: { text?: string; thought?: boolean }[] };
}
interface GeminiResponse {
  promptFeedback?: { blockReason?: string };
  candidates?: GeminiCandidate[];
}

function extractGeminiText(data: unknown): string {
  const d = data as GeminiResponse;
  if (d.promptFeedback?.blockReason) {
    throw new HttpError(400, "blocked", "Gemini's safety filter blocked this request. Try rephrasing.");
  }
  const cand = d.candidates?.[0];
  const text = (cand?.content?.parts ?? [])
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text as string)
    .join("");
  if (!text.trim()) {
    throw new HttpError(502, "bad_response", "The AI returned an empty response for the PDF.");
  }
  return text;
}

export default async function handler(req: Req, res: ServerResponse) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return send(res, 405, { error: "Method not allowed.", code: "method_not_allowed" });
    }
    if (!originAllowed(req)) return send(res, 403, { error: "Request not allowed.", code: "forbidden" });
    if (!rateLimit(req, res, 20)) return;

    let body: unknown;
    try {
      body = await readRequestBody(req, MAX_FILE_BYTES + 50_000);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message, code: err.code });
      return send(res, 400, { error: "Invalid request body.", code: "bad_request" });
    }
    if (!isObj(body)) return send(res, 400, { error: "Invalid request.", code: "bad_request" });

    const reqBody = body as ExtractRequest;
    const filename = typeof reqBody.filename === "string" ? reqBody.filename : "upload";
    const data = typeof reqBody.data === "string" ? reqBody.data : null;
    const mimeType = typeof reqBody.mimeType === "string" ? reqBody.mimeType : null;

    if (!data) return send(res, 400, { error: "No file data provided.", code: "missing_file" });
    if (!mimeType || !isValidMimeType(mimeType)) {
      return send(res, 400, { error: "Unsupported file type. Upload a PDF, .docx, .txt, or .md file.", code: "unsupported_type" });
    }

    // Rough size check on base64 data (base64 is ~33% overhead)
    const approxBytes = Math.floor((data.length * 3) / 4);
    if (approxBytes > MAX_FILE_BYTES) {
      return send(res, 413, { error: "File is too large. Maximum 8 MB.", code: "file_too_large" });
    }

    let text: string;
    const ext = fileExtFromMime(mimeType);
    try {
      if (ext === ".pdf") {
        text = await extractPdfViaGemini(data);
      } else if (ext === ".docx") {
        text = await extractDocx(data);
      } else {
        text = await extractTextFile(data);
      }
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message, code: err.code });
      if (isGeminiError(err)) {
        const status = err.status ?? 502;
        return send(res, status, { error: err.message, code: err.code });
      }
      return send(res, 500, { error: "Extraction failed. Please try again or paste your resume text.", code: "extraction_error" });
    }

    return send(res, 200, { text, filename, mimeType });
  } catch (err) {
    return send(res, 500, { error: "Unexpected server error. Please try again.", code: "internal_error" });
  }
}
