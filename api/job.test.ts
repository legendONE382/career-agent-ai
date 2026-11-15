import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPrivateIp, htmlToText } from "../api/job";

describe("isPrivateIp (SSRF protection)", () => {
  it("rejects private IPv4 ranges", () => {
    expect(isPrivateIp("10.0.0.1")).toBe(true);
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("192.168.1.1")).toBe(true);
    expect(isPrivateIp("100.64.0.1")).toBe(true);
    expect(isPrivateIp("169.254.0.1")).toBe(true);
    expect(isPrivateIp("224.0.0.1")).toBe(true);
    expect(isPrivateIp("0.0.0.0")).toBe(true);
  });

  it("allows public IPv4", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("1.1.1.1")).toBe(false);
    expect(isPrivateIp("93.184.216.34")).toBe(false);
  });

  it("rejects private IPv6", () => {
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("fc00::1")).toBe(true);
    expect(isPrivateIp("::ffff:192.168.1.1")).toBe(true);
    expect(isPrivateIp("::ffff:8.8.8.8")).toBe(false);
  });

  it("rejects non-IP input", () => {
    expect(isPrivateIp("not an ip")).toBe(true);
    expect(isPrivateIp("")).toBe(true);
  });
});

describe("htmlToText", () => {
  it("strips scripts, styles and converts lists/breaks", () => {
    const html = "<html><script>alert('x')</script><style>body{}</style><body><h1>Title</h1><ul><li>one</li><li>two</li></ul><p>para<br/>break</p></body></html>";
    const text = htmlToText(html);
    expect(text).not.toContain("alert");
    expect(text).not.toContain("script");
    expect(text).not.toContain("style");
    expect(text).toContain("Title");
    expect(text).toContain("• one");
    expect(text).toContain("• two");
    expect(text).toContain("para");
  });

  it("decodes html entities", () => {
    expect(htmlToText("<p>At&amp;t &lt;Co&gt;</p>")).toContain("At&t <Co>");
    expect(htmlToText("a&nbsp;b")).toContain("a b");
    expect(htmlToText("&nbsp;")).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(htmlToText("")).toBe("");
    expect(htmlToText("<script>only</script>")).toBe("");
  });
});
