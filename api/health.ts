/**
 * Vercel Serverless Function — tells the front-end whether the server-side
 * Gemini key is configured (never returns the key itself).
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export default function handler(_req: IncomingMessage, res: ServerResponse) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(
    JSON.stringify({
      ok: true,
      configured: Boolean((process.env.GEMINI_API_KEY || "").trim()),
      model: (process.env.GEMINI_MODEL || "gemini-flash-latest").trim(),
    }),
  );
}
