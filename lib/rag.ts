import { embedQuery } from "./embeddings";
import { getChatModel, getOpenAIClient } from "./openai";
import { withRetry } from "./retry";
import type { ChatApiResponse, RetrievalMatch, SiteIndex, Source } from "./types";
import { searchIndex } from "./vector-store";

const TOP_K = 5;

function uniqueSources(matches: RetrievalMatch[]): Source[] {
  const byUrl = new Map<string, Source>();

  for (const match of matches) {
    if (!byUrl.has(match.chunk.url)) {
      byUrl.set(match.chunk.url, { url: match.chunk.url, title: match.chunk.title });
    }
  }

  return [...byUrl.values()];
}

function buildContext(matches: RetrievalMatch[]): string {
  return matches
    .map((match, index) => {
      return [
        `SOURCE ${index + 1}`,
        `URL: ${match.chunk.url}`,
        `Title: ${match.chunk.title}`,
        `Chunk: ${match.chunk.chunkIndex}`,
        `Similarity: ${match.score.toFixed(4)}`,
        "Excerpt:",
        match.chunk.text
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

export async function answerQuestion(question: string, siteIndex: SiteIndex): Promise<ChatApiResponse> {
  if (!siteIndex) {
    throw new Error("No crawled site index found. Crawl a website before asking questions.");
  }

  const queryEmbedding = await embedQuery(question);
  const matches = searchIndex(siteIndex, queryEmbedding, TOP_K);

  if (matches.length === 0) {
    return {
      answer: "I could not find that information in the crawled website content.",
      sources: []
    };
  }

  const client = getOpenAIClient();
  const model = getChatModel();
  const context = buildContext(matches);
  const sources = uniqueSources(matches);

  // Wrap in retry — transient 429/503 errors are retried with exponential backoff
  const completion = await withRetry(
    () =>
      client.chat.completions.create({
        model,
        temperature: 0,
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
        console.warn(`⚠️ Chat completion retry #${attempt}`);
      }
    }
  );

  const answer = completion.choices[0]?.message?.content?.trim() || "I could not find that information in the crawled website content.";

  // Only show sources when the answer actually contains relevant content.
  // If the LLM says the info isn't in the excerpts, suppress the source links
  // so we don't show misleading references alongside a "not found" response.
  const notFoundPhrases = [
    "not contain",
    "does not contain",
    "do not contain",
    "not found",
    "cannot find",
    "could not find",
    "no information",
    "not mention",
    "not available",
    "not provided",
    "i'm sorry",
    "i am sorry",
    "sorry, but"
  ];
  const answerLower = answer.toLowerCase();
  const isNotFound = notFoundPhrases.some((phrase) => answerLower.includes(phrase));

  return {
    answer,
    sources: isNotFound ? [] : sources
  };
}
