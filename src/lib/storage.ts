/* localStorage persistence — no database, no accounts. Everything stays in the visitor's browser. */
import type { SessionRecord } from "../types";

const SESSIONS_KEY = "careeragent.sessions.v1";
const DRAFT_KEY = "careeragent.draft.v1";
const MAX_SESSIONS = 20;

export function loadSessions(): SessionRecord[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as SessionRecord[])
      .filter((s) => s && typeof s.id === "string" && typeof s.overall === "number" && Array.isArray(s.questions) && Array.isArray(s.answers))
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

function persist(list: SessionRecord[]): SessionRecord[] {
  let current = list.slice(0, MAX_SESSIONS);
  // If we hit the storage quota, drop the oldest sessions until it fits.
  while (current.length) {
    try {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(current));
      return current;
    } catch {
      current = current.slice(0, -1);
    }
  }
  return [];
}

export function saveSession(rec: SessionRecord): SessionRecord[] {
  return persist([rec, ...loadSessions().filter((s) => s.id !== rec.id)]);
}

export function deleteSession(id: string): SessionRecord[] {
  return persist(loadSessions().filter((s) => s.id !== id));
}

export function clearSessions(): SessionRecord[] {
  try {
    localStorage.removeItem(SESSIONS_KEY);
  } catch {
    /* ignore */
  }
  return [];
}

export interface Draft {
  job: string;
  resume: string;
}

export function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return { job: "", resume: "" };
    const d = JSON.parse(raw) as Partial<Draft>;
    return { job: typeof d.job === "string" ? d.job : "", resume: typeof d.resume === "string" ? d.resume : "" };
  } catch {
    return { job: "", resume: "" };
  }
}

export function saveDraft(draft: Draft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* ignore quota errors */
  }
}
