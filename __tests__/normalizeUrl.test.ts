import { describe, it, expect } from "vitest";
import { normalizeUrl } from "../lib/crawler";

describe("normalizeUrl", () => {
  it("returns null for non-http protocols", () => {
    expect(normalizeUrl("ftp://example.com")).toBeNull();
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("mailto:test@example.com")).toBeNull();
  });

  it("lowercases the hostname", () => {
    expect(normalizeUrl("https://Example.COM/Page")).toBe("https://example.com/Page");
  });

  it("strips hash fragments", () => {
    expect(normalizeUrl("https://example.com/page#section")).toBe("https://example.com/page");
  });

  it("strips tracking parameters (utm_*, fbclid, gclid)", () => {
    const url = "https://example.com/page?utm_source=twitter&utm_medium=social&real=yes";
    const result = normalizeUrl(url);
    expect(result).toBe("https://example.com/page?real=yes");
  });

  it("removes all utm params even when no other params exist", () => {
    const url = "https://example.com/?utm_source=google&utm_campaign=test";
    const result = normalizeUrl(url);
    expect(result).toBe("https://example.com/");
  });

  it("strips trailing slashes from paths (except root)", () => {
    expect(normalizeUrl("https://example.com/about/")).toBe("https://example.com/about");
    // Root path keeps its slash
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("strips default ports (80 for http, 443 for https)", () => {
    expect(normalizeUrl("https://example.com:443/page")).toBe("https://example.com/page");
    expect(normalizeUrl("http://example.com:80/page")).toBe("http://example.com/page");
  });

  it("keeps non-default ports", () => {
    expect(normalizeUrl("https://example.com:8080/page")).toBe("https://example.com:8080/page");
  });

  it("deduplicates consecutive slashes in path", () => {
    expect(normalizeUrl("https://example.com//a///b")).toBe("https://example.com/a/b");
  });

  it("resolves relative URLs against a base", () => {
    const result = normalizeUrl("/about", "https://example.com/page");
    expect(result).toBe("https://example.com/about");
  });

  it("returns null for completely invalid input", () => {
    expect(normalizeUrl("not a url")).toBeNull();
    expect(normalizeUrl("")).toBeNull();
  });

  it("sorts query parameters for consistent deduplication", () => {
    const url1 = normalizeUrl("https://example.com/?b=2&a=1");
    const url2 = normalizeUrl("https://example.com/?a=1&b=2");
    expect(url1).toBe(url2);
  });
});
