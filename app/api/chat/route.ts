import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { embedQuery } from "@/lib/embeddings";
import { createLogger } from "@/lib/logger";
import { getChatModel, getOpenAIClient } from "@/lib/openai";
import { chatLimiter, getClientIp } from "@/lib/rate-limit";
import { withRetry } from "@/lib/retry";
import type { Source } from "@/lib/types";
import { searchIndex, vectorStore } from "@/lib/vector-store";

const log = createLogger("api/chat");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOP_K = 5;

// ── Input validation schema ────────────────────────────────────
const ChatRequestSchema = z.object({
  question: z
    .string({ required_error: "Question is required." })
    .trim()
    .min(1, "Question is required.")
    .max(2000, "Question is too long (max 2000 characters)."),
  siteId: z
    .string({ required_error: "Site ID is required. Crawl a website first." })
    .min(1, "Site ID is required. Crawl a website first.")
});

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  // ── Rate limiting ──────────────────────────────────────────────
  const clientIp = getClientIp(request);
  const rateLimitResult = chatLimiter.check(clientIp);

  if (!rateLimitResult.allowed) {
    log.warn({ clientIp }, "Rate limited");
    return NextResponse.json(
      {
        error: `Too many requests. Please wait ${Math.ceil((rateLimitResult.retryAfterMs ?? 5000) / 1000)} seconds before asking again.`
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rateLimitResult.retryAfterMs ?? 5000) / 1000))
        }
      }
    );
  }

  try {
    // ── Input validation ───────────────────────────────────────────
    const rawBody = await request.json();
    const parseResult = ChatRequestSchema.safeParse(rawBody);

    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0];
      log.warn({ error: firstError?.message }, "Invalid chat request");
      return NextResponse.json(
        { error: firstError?.message ?? "Invalid request." },
        { status: 400 }
      );
    }

    const { question, siteId } = parseResult.data;
    log.info({ siteId, questionLength: question.length }, "Chat request received");

    // ── Look up the index on the server ────────────────────────────
    const siteIndex = vectorStore.get(siteId);
    if (!siteIndex) {
      log.warn({ siteId }, "Site index not found");
      return NextResponse.json(
        { error: "Site index not found. The index may have expired — please crawl the website again." },
        { status: 404 }
      );
    }

    // ── Retrieve relevant chunks ──────────────────────────────────
    const retrievalStart = Date.now();
    const queryEmbedding = await embedQuery(question);
    const matches = searchIndex(siteIndex, queryEmbedding, TOP_K);
    const retrievalMs = Date.now() - retrievalStart;

    log.info(
      {
        matchCount: matches.length,
        topScore: matches[0]?.score?.toFixed(4),
        retrievalMs
      },
      "Retrieval completed"
    );

    if (matches.length === 0) {
      return NextResponse.json({
        answer: "I could not find that information in the crawled website content.",
        sources: []
      });
    }

    // ── Build context + sources with excerpts (Item 10) ──────────
    const sourcesByUrl = new Map<string, Source>();
    const contextParts: string[] = [];

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const excerpt = match.chunk.text.length > 300
        ? match.chunk.text.slice(0, 300) + "…"
        : match.chunk.text;

      if (!sourcesByUrl.has(match.chunk.url)) {
        sourcesByUrl.set(match.chunk.url, {
          url: match.chunk.url,
          title: match.chunk.title,
          excerpt
        });
      }

      contextParts.push(
        [
          `SOURCE ${i + 1}`,
          `URL: ${match.chunk.url}`,
          `Title: ${match.chunk.title}`,
          `Chunk: ${match.chunk.chunkIndex}`,
          `Similarity: ${match.score.toFixed(4)}`,
          "Excerpt:",
          match.chunk.text
        ].join("\n")
      );
    }

    const context = contextParts.join("\n\n---\n\n");
    const sources = [...sourcesByUrl.values()];

    // ── Stream the LLM response (Item 9) ──────────────────────────
    const client = getOpenAIClient();
    const model = getChatModel();

    const stream = await withRetry(
      () =>
        client.chat.completions.create({
          model,
          temperature: 0,
          stream: true,
          messages: [
            {
              role: "system",
              content: [
                "Answer only from the provided website excerpts.",
                "Do not use outside knowledge.",
                "If the answer is missing, say so clearly.",
                "Cite sources using the provided source URLs.",
                "Keep the answer concise and useful."
              ].join("\n")
            },
            {
              role: "user",
              content: [`Question: ${question}`, "", "Website excerpts:", context].join("\n")
            }
          ]
        }),
      {
        maxRetries: 3,
        onRetry: (_error, attempt) => {
          log.warn({ attempt }, "Chat completion retry");
        }
      }
    );

    // ── Stream via SSE ────────────────────────────────────────────
    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        let fullAnswer = "";

        try {
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) {
              fullAnswer += delta;
              // Send token as an SSE data event
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: "token", content: delta })}\n\n`)
              );
            }
          }

          // ── Not-found suppression ────────────────────────────────
          const notFoundPhrases = [
            "not contain", "does not contain", "do not contain", "not found",
            "cannot find", "could not find", "no information", "not mention",
            "not available", "not provided", "i'm sorry", "i am sorry", "sorry, but"
          ];
          const answerLower = fullAnswer.toLowerCase();
          const isNotFound = notFoundPhrases.some((phrase) => answerLower.includes(phrase));

          // Send sources and completion event
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "done",
                sources: isNotFound ? [] : sources
              })}\n\n`
            )
          );

          const totalMs = Date.now() - startTime;
          log.info(
            { siteId, answerLength: fullAnswer.length, isNotFound, totalMs },
            "Chat response streamed"
          );
        } catch (streamError) {
          const msg = streamError instanceof Error ? streamError.message : String(streamError);
          log.error({ error: msg }, "Stream error");
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", error: msg })}\n\n`)
          );
        } finally {
          controller.close();
        }
      }
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      }
    });
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    log.error({ error: raw, durationMs: Date.now() - startTime }, "Chat pipeline failed");

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
