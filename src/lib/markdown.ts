/* Tiny, safe Markdown → HTML renderer (headings, lists, bold/italic, links, hr). Input is HTML-escaped first. */

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(raw: string): string {
  let s = escapeHtml(raw);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
  return s;
}

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  let list: "ul" | "ol" | null = null;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      html.push(`<p>${para.map(inline).join("<br/>")}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (list) {
      html.push(`</${list}>`);
      list = null;
    }
  };

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      flushPara();
      closeList();
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(t);
    if (h) {
      flushPara();
      closeList();
      const level = Math.min(h[1].length, 3);
      html.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      flushPara();
      closeList();
      html.push("<hr/>");
      continue;
    }
    const ul = /^[-*•]\s+(.*)$/.exec(t);
    const ol = /^\d+[.)]\s+(.*)$/.exec(t);
    if (ul || ol) {
      flushPara();
      const kind = ul ? "ul" : "ol";
      if (list !== kind) {
        closeList();
        html.push(`<${kind}>`);
        list = kind;
      }
      html.push(`<li>${inline((ul || ol)![1])}</li>`);
      continue;
    }
    closeList();
    para.push(t);
  }
  flushPara();
  closeList();
  return html.join("\n");
}

export const RESUME_EXPORT_CSS = `
  @page { margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px; background: #fff; display: flex; justify-content: center; }
  .resume-doc { max-width: 780px; width: 100%; font-family: "Inter", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 13.5px; line-height: 1.55; color: #14161b; }
  .resume-doc h1 { font-size: 28px; line-height: 1.1; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 4px; }
  .resume-doc h2 { font-size: 11.5px; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 700; margin: 20px 0 8px; padding-bottom: 4px; border-bottom: 1.5px solid #14161b; }
  .resume-doc h3 { font-size: 14px; font-weight: 650; margin: 12px 0 2px; }
  .resume-doc p { margin: 0 0 6px; }
  .resume-doc ul { margin: 4px 0 8px; padding-left: 18px; }
  .resume-doc ol { margin: 4px 0 8px; padding-left: 20px; }
  .resume-doc li { margin: 2px 0; }
  .resume-doc a { color: #2b3bd6; }
  .resume-doc hr { border: 0; border-top: 1px solid #cfcab9; margin: 12px 0; }
  @media print { body { padding: 0; } }
`;

export function resumeToHtmlDocument(md: string, title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${RESUME_EXPORT_CSS}</style>
</head>
<body>
<main class="resume-doc">
${markdownToHtml(md)}
</main>
</body>
</html>`;
}

/** Best-effort first heading ("# Name") for file naming. */
export function resumeName(md: string): string {
  const m = /^#\s+(.+)$/m.exec(md);
  return m ? m[1].replace(/[*_`]/g, "").trim() : "resume";
}
