export type CrawlConfig = {
  maxPages: number;
  maxDepth: number;
  requestDelayMs: number;
  fetchTimeoutMs: number;
  minPageWords: number;
  userAgent: string;
};

export type CrawledPage = {
  url: string;
  title: string;
  text: string;
  depth: number;
};

export type CrawlOutput = {
  rootUrl: string;
  pages: CrawledPage[];
  errors: string[];
  warnings: string[];
};

export type TextChunk = {
  id: string;
  url: string;
  title: string;
  text: string;
  chunkIndex: number;
};

export type IndexedChunk = TextChunk & {
  embedding: number[];
};

export type SiteIndex = {
  siteId: string;
  rootUrl: string;
  hostname: string;
  indexedAt: string;
  chunks: IndexedChunk[];
};

export type RetrievalMatch = {
  chunk: IndexedChunk;
  score: number;
};

export type Source = {
  url: string;
  title: string;
  /** The relevant passage that was used to answer. Optional for backward compat. */
  excerpt?: string;
};

export type CrawlApiResponse = {
  siteId: string;
  rootUrl: string;
  pagesCrawled: number;
  chunksCreated: number;
  errors: string[];
  warnings: string[];
};

export type ChatApiResponse = {
  answer: string;
  sources: Source[];
};
