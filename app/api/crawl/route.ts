import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { chunkPages } from "@/lib/chunk";
import { crawlSite, DEFAULT_CRAWL_CONFIG } from "@/lib/crawler";
import { embedTexts } from "@/lib/embeddings";
import { createLogger } from "@/lib/logger";
import { crawlLimiter, getClientIp } from "@/lib/rate-limit";
import type { IndexedChunk, SiteIndex } from "@/lib/types";
import { vectorStore } from "@/lib/vector-store";

const log = createLogger("api/crawl");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Input validation schema ────────────────────────────────────
const CrawlRequestSchema = z.object({
  url: z
    .string({ required_error: "URL is required." })
    .trim()
    .min(1, "URL is required.")
    .url("Please enter a valid URL."),
  maxPages: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .default(DEFAULT_CRAWL_CONFIG.maxPages),
  maxDepth: z
    .number()
    .int()
    .min(0)
    .max(4)
    .optional()
    .default(DEFAULT_CRAWL_CONFIG.maxDepth)
});

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  // ── Rate limiting ──────────────────────────────────────────────
  const clientIp = getClientIp(request);
  const rateLimitResult = crawlLimiter.check(clientIp);

  if (!rateLimitResult.allowed) {
    log.warn({ clientIp }, "Rate limited");
    return NextResponse.json(
      {
        error: `Too many crawl requests. Please wait ${Math.ceil((rateLimitResult.retryAfterMs ?? 10000) / 1000)} seconds before trying again.`
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rateLimitResult.retryAfterMs ?? 10000) / 1000))
        }
      }
    );
  }

  try {
    // ── Input validation ───────────────────────────────────────────
    const rawBody = await request.json();
    const parseResult = CrawlRequestSchema.safeParse(rawBody);

    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0];
      log.warn({ error: firstError?.message }, "Invalid crawl request");
      return NextResponse.json(
        { error: firstError?.message ?? "Invalid request." },
        { status: 400 }
      );
    }

    const { url, maxPages, maxDepth } = parseResult.data;
    log.info({ url, maxPages, maxDepth, clientIp }, "Crawl started");

    // ── Crawl ────────────────────────────────────────────────────
    const crawlStart = Date.now();
    const crawl = await crawlSite(url, { maxPages, maxDepth });
    const crawlDurationMs = Date.now() - crawlStart;
    log.info(
      { url, pagesCrawled: crawl.pages.length, warnings: crawl.warnings.length, errors: crawl.errors.length, crawlDurationMs },
      "Crawl completed"
    );

    const chunks = chunkPages(crawl.pages);
    if (chunks.length === 0) {
      log.warn({ url }, "Crawl produced zero chunks");
      return NextResponse.json(
        {
          error: "Crawl completed, but no useful text chunks were found.",
          warnings: crawl.warnings,
          errors: crawl.errors
        },
        { status: 422 }
      );
    }

    // ── Embed & index ────────────────────────────────────────────
    const embedStart = Date.now();
    const embeddings = await embedTexts(chunks.map((chunk) => chunk.text));
    const embedDurationMs = Date.now() - embedStart;
    log.info({ chunksEmbedded: chunks.length, embedDurationMs }, "Embedding completed");

    const indexedChunks: IndexedChunk[] = chunks.map((chunk, index) => ({
      ...chunk,
      embedding: embeddings[index]
    }));

    const root = new URL(crawl.rootUrl);
    const siteId = `${root.hostname}-${Date.now()}`;
    const siteIndex: SiteIndex = {
      siteId,
      rootUrl: crawl.rootUrl,
      hostname: root.hostname,
      indexedAt: new Date().toISOString(),
      chunks: indexedChunks
    };

    vectorStore.save(siteIndex);

    const totalDurationMs = Date.now() - startTime;
    log.info({ siteId, pagesCrawled: crawl.pages.length, chunksCreated: chunks.length, totalDurationMs }, "Index saved — crawl pipeline complete");

    return NextResponse.json({
      siteId,
      rootUrl: crawl.rootUrl,
      pagesCrawled: crawl.pages.length,
      chunksCreated: chunks.length,
      errors: crawl.errors,
      warnings: crawl.warnings
    });
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    log.error({ error: raw, durationMs: Date.now() - startTime }, "Crawl pipeline failed");

    let message = raw;
    if (raw.includes("503")) {
      message = "The AI service is temporarily unavailable (503). Please wait a moment and try again.";
    } else if (raw.includes("429")) {
      message = "Too many requests — the AI service is rate-limiting us (429). Please wait a few seconds and try again.";
    } else if (raw.includes("401") || raw.includes("403")) {
      message = "Authentication failed. Please check that your API key is correct in .env.local.";
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
