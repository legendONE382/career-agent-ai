import { describe, expect, it } from "vitest";
import { avg, clamp, formatDate, slugify, uid, wordCount } from "./utils";

describe("wordCount", () => {
  it("counts words", () => {
    expect(wordCount("Hello world")).toBe(2);
    expect(wordCount("")).toBe(0);
    expect(wordCount("   ")).toBe(0);
    expect(wordCount("one two   three")).toBe(3);
  });
});

describe("clamp", () => {
  it("clamps to range", () => {
    expect(clamp(-5, 0, 100)).toBe(0);
    expect(clamp(200, 0, 100)).toBe(100);
    expect(clamp(50, 0, 100)).toBe(50);
  });
});

describe("avg", () => {
  it("averages numbers", () => {
    expect(avg([1, 2, 3, 4])).toBe(2.5);
    expect(avg([])).toBe(0);
  });
});

describe("slugify", () => {
  it("creates a slug", () => {
    expect(slugify("Senior Frontend Engineer")).toBe("senior-frontend-engineer");
    expect(slugify("")).toBe("resume");
  });
});

describe("uid", () => {
  it("returns unique strings", () => {
    expect(uid()).not.toBe(uid());
  });
});

describe("formatDate", () => {
  it("formats a timestamp", () => {
    const d = formatDate(new Date(2026, 0, 15).getTime());
    expect(d).toContain("2026");
    expect(formatDate(0)).toContain("1970");
  });
});
