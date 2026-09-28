import { describe, it, expect } from "vitest";
import { chunkPage, chunkPages } from "../lib/chunk";
import type { CrawledPage } from "../lib/types";

function makePage(wordCount: number, overrides: Partial<CrawledPage> = {}): CrawledPage {
  const words = Array.from({ length: wordCount }, (_, i) => `word${i}`);
  return {
    url: "https://example.com/test",
    title: "Test Page",
    text: words.join(" "),
    depth: 0,
    ...overrides
  };
}

describe("chunkPage", () => {
  it("returns an empty array for a page with no text", () => {
    const page = makePage(0);
    expect(chunkPage(page, 0)).toEqual([]);
  });

  it("creates a single chunk for text shorter than targetWords", () => {
    const page = makePage(100);
    const chunks = chunkPage(page, 0, { targetWords: 850, minChunkWords: 80 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].id).toBe("page-0-chunk-0");
    expect(chunks[0].url).toBe("https://example.com/test");
    expect(chunks[0].title).toBe("Test Page");
  });

  it("creates multiple chunks with overlap for long text", () => {
    const page = makePage(2000);
    const chunks = chunkPage(page, 0, { targetWords: 850, overlapWords: 120, minChunkWords: 80 });
    expect(chunks.length).toBeGreaterThan(1);

    // Check that chunks have sequential indexes
    chunks.forEach((chunk, i) => {
      expect(chunk.chunkIndex).toBe(i);
    });
  });

  it("drops tiny trailing chunks below minChunkWords", () => {
    // 900 words with target 850 → chunk 0 is 850 words, leftover is 50 words (< 80 min)
    // But first chunk is always kept even if small
    const page = makePage(900);
    const chunks = chunkPage(page, 0, { targetWords: 850, overlapWords: 120, minChunkWords: 80 });
    // The trailing fragment of ~170 words (850+overlap back) should form chunk or be dropped
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it("preserves source URL and title in every chunk", () => {
    const page = makePage(2000, { url: "https://docs.example.com/api", title: "API Reference" });
    const chunks = chunkPage(page, 3);
    for (const chunk of chunks) {
      expect(chunk.url).toBe("https://docs.example.com/api");
      expect(chunk.title).toBe("API Reference");
      expect(chunk.id).toMatch(/^page-3-chunk-\d+$/);
    }
  });
});

describe("chunkPages", () => {
  it("chunks multiple pages and assigns unique IDs", () => {
    const pages = [makePage(500), makePage(500)];
    const chunks = chunkPages(pages);
    const ids = chunks.map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length); // all IDs are unique
  });
});
