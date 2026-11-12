/* Renders a shareable 1200×630 scorecard PNG entirely client-side with <canvas>. */
import type { SessionRecord } from "../types";
import { scoreColor, tierFor } from "./scoring";

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

export async function renderShareCard(rec: SessionRecord): Promise<Blob | null> {
  try {
    await document.fonts?.ready;
  } catch {
    /* fonts API unavailable */
  }
  const W = 1200;
  const H = 630;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const display = '"Bricolage Grotesque", "Inter", system-ui, sans-serif';
  const body = '"Inter", system-ui, sans-serif';
  const mono = '"JetBrains Mono", ui-monospace, monospace';

  // Background
  ctx.fillStyle = "#0F1115";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(255,255,255,0.045)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 44) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 44) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  const glow = ctx.createRadialGradient(300, 320, 20, 300, 320, 420);
  glow.addColorStop(0, "rgba(200,245,96,0.22)");
  glow.addColorStop(1, "rgba(200,245,96,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Brand
  ctx.fillStyle = "#C8F560";
  roundRect(ctx, 64, 56, 40, 40, 11);
  ctx.fill();
  ctx.fillStyle = "#0F1115";
  ctx.font = `700 24px ${display}`;
  ctx.textBaseline = "middle";
  ctx.fillText("✦", 74, 77);
  ctx.fillStyle = "#F4F1EA";
  ctx.font = `700 26px ${display}`;
  ctx.fillText("CareerAgent.ai", 116, 77);

  // Score ring
  const cx = 300;
  const cy = 340;
  const radius = 150;
  ctx.lineWidth = 26;
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = scoreColor(rec.overall);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * Math.max(rec.overall, 1)) / 100);
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.fillStyle = "#F4F1EA";
  ctx.font = `800 120px ${display}`;
  ctx.fillText(String(rec.overall), cx, cy - 6);
  ctx.fillStyle = "rgba(244,241,234,0.55)";
  ctx.font = `500 26px ${mono}`;
  ctx.fillText("/ 100", cx, cy + 74);

  // Right column
  const tier = tierFor(rec.overall);
  ctx.textAlign = "left";
  ctx.fillStyle = "#C8F560";
  ctx.font = `500 22px ${mono}`;
  ctx.fillText("MOCK INTERVIEW SCORECARD", 560, 176);
  ctx.fillStyle = "#F4F1EA";
  ctx.font = `800 62px ${display}`;
  ctx.fillText(truncate(ctx, `${tier.emoji} ${tier.label}`, 580), 560, 244);
  ctx.fillStyle = "rgba(244,241,234,0.7)";
  ctx.font = `500 26px ${body}`;
  const role = rec.jobTitle + (rec.company ? ` · ${rec.company}` : "");
  ctx.fillText(truncate(ctx, role || "Target role", 580), 560, 292);

  const bars: [string, number][] = [
    ["Content", rec.content],
    ["Delivery", rec.delivery],
    ["Body language", rec.body],
  ];
  bars.forEach(([label, value], i) => {
    const y = 350 + i * 62;
    ctx.fillStyle = "rgba(244,241,234,0.75)";
    ctx.font = `500 22px ${body}`;
    ctx.fillText(label, 560, y);
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    roundRect(ctx, 760, y - 14, 300, 16, 8);
    ctx.fill();
    ctx.fillStyle = scoreColor(value);
    roundRect(ctx, 760, y - 14, Math.max(16, (300 * value) / 100), 16, 8);
    ctx.fill();
    ctx.fillStyle = "#F4F1EA";
    ctx.font = `600 22px ${mono}`;
    ctx.fillText(String(value), 1080, y);
  });

  ctx.fillStyle = "rgba(244,241,234,0.5)";
  ctx.font = `500 20px ${body}`;
  ctx.fillText(`Resume ATS match  ${rec.atsBefore}% → ${rec.atsAfter}%`, 560, 548);
  ctx.textAlign = "right";
  ctx.fillText(new Date(rec.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }), 1136, 590);

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}
