import { describe, it, expect } from "vitest";
import { cosineSimilarity, searchIndex } from "../lib/vector-store";
import type { SiteIndex, IndexedChunk } from "../lib/types";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const a = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it("returns -1 for opposite vectors", () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });

  it("returns 0 for empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("returns 0 when vector lengths differ", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it("returns 0 for zero vectors", () => {
    expect(cosineSimilarity([0, 0, 0], [0, 0, 0])).toBe(0);
  });

  it("handles mixed positive and negative values", () => {
    const a = [1, -1, 2];
    const b = [2, -2, 4];
    // These are parallel (b = 2*a), so similarity should be 1
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });
});

describe("searchIndex", () => {
  function makeChunk(id: string, embedding: number[]): IndexedChunk {
    return {
      id,
      url: `https://example.com/${id}`,
      title: `Page ${id}`,
      text: `Content for ${id}`,
      chunkIndex: 0,
      embedding
    };
  }

  function makeIndex(chunks: IndexedChunk[]): SiteIndex {
    return {
      siteId: "test-site",
      rootUrl: "https://example.com",
      hostname: "example.com",
      indexedAt: new Date().toISOString(),
      chunks
    };
  }

  it("returns top-K results sorted by score descending", () => {
    const index = makeIndex([
      makeChunk("a", [1, 0, 0]),
      makeChunk("b", [0, 1, 0]),
      makeChunk("c", [0.9, 0.1, 0])
    ]);

    const query = [1, 0, 0]; // Most similar to "a", then "c", then "b"
    const results = searchIndex(index, query, 2);

    expect(results).toHaveLength(2);
    expect(results[0].chunk.id).toBe("a");
    expect(results[1].chunk.id).toBe("c");
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it("returns empty array for empty index", () => {
    const index = makeIndex([]);
    expect(searchIndex(index, [1, 0, 0], 5)).toHaveLength(0);
  });

  it("respects topK parameter", () => {
    const chunks = Array.from({ length: 20 }, (_, i) => {
      const emb = new Array(3).fill(0);
      emb[0] = Math.random();
      emb[1] = Math.random();
      emb[2] = Math.random();
      return makeChunk(`chunk-${i}`, emb);
    });
    const index = makeIndex(chunks);
    const results = searchIndex(index, [1, 0, 0], 3);
    expect(results).toHaveLength(3);
  });
});
