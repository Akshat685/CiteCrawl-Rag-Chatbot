"use client";

import { FormEvent, useRef, useEffect, useState } from "react";
import type { CrawlApiResponse, Source } from "@/lib/types";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
};

export default function HomePage() {
  const [url, setUrl] = useState("");
  const [crawlResult, setCrawlResult] = useState<CrawlApiResponse | null>(null);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [crawlError, setCrawlError] = useState<string | null>(null);
  const [isCrawling, setIsCrawling] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isAnswering, setIsAnswering] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat to bottom when new messages arrive
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  async function handleCrawl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCrawlError(null);
    setChatError(null);
    setCrawlResult(null);
    setSiteId(null);
    setMessages([]);
    setIsCrawling(true);

    try {
      const response = await fetch("/api/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      const data = await response.json() as CrawlApiResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to crawl site.");
      }

      setSiteId(data.siteId);
      setCrawlResult(data);
    } catch (error) {
      setCrawlError(error instanceof Error ? error.message : "Failed to crawl site.");
    } finally {
      setIsCrawling(false);
    }
  }

  async function handleAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || !siteId) {
      return;
    }

    setChatError(null);
    setQuestion("");
    // Add user message and a placeholder assistant message
    setMessages((current) => [
      ...current,
      { role: "user", content: trimmedQuestion },
      { role: "assistant", content: "" }
    ]);
    setIsAnswering(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmedQuestion, siteId })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error ?? "Failed to answer question.");
      }

      // ── Read SSE stream ────────────────────────────────────────
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream.");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events from buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);

          try {
            const event = JSON.parse(payload);

            if (event.type === "token") {
              // Append token to the last (assistant) message
              setMessages((current) => {
                const updated = [...current];
                const last = updated[updated.length - 1];
                if (last && last.role === "assistant") {
                  updated[updated.length - 1] = {
                    ...last,
                    content: last.content + event.content
                  };
                }
                return updated;
              });
            } else if (event.type === "done") {
              // Attach sources to the last message
              setMessages((current) => {
                const updated = [...current];
                const last = updated[updated.length - 1];
                if (last && last.role === "assistant") {
                  updated[updated.length - 1] = {
                    ...last,
                    sources: event.sources
                  };
                }
                return updated;
              });
            } else if (event.type === "error") {
              setChatError(event.error);
            }
          } catch {
            // Ignore malformed JSON lines
          }
        }
      }
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Failed to answer question.");
      // Remove the empty placeholder assistant message on error
      setMessages((current) => {
        const last = current[current.length - 1];
        if (last?.role === "assistant" && !last.content) {
          return current.slice(0, -1);
        }
        return current;
      });
    } finally {
      setIsAnswering(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-slate-500">Crawl + RAG</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight">Chat with a Website</h1>
          <p className="mt-3 max-w-2xl text-slate-600">
            Enter a website URL, crawl up to 10 pages within the same hostname, index the readable content, and ask
            grounded questions with source links.
          </p>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <form onSubmit={handleCrawl} className="flex flex-col gap-4 md:flex-row">
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              type="url"
              required
              placeholder="https://example.com"
              aria-label="Website URL to crawl"
              className="min-h-12 flex-1 rounded-2xl border border-slate-300 px-4 outline-none transition focus:border-slate-950 focus:ring-4 focus:ring-slate-200"
            />
            <button
              type="submit"
              disabled={isCrawling}
              className="min-h-12 rounded-2xl bg-slate-950 px-6 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isCrawling ? "Crawling..." : "Crawl site"}
            </button>
          </form>

          <p className="mt-3 text-sm text-slate-500">Defaults: max pages 10, max depth 2, polite delay between requests.</p>

          {crawlError ? (
            <div role="alert" className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{crawlError}</div>
          ) : null}

          {crawlResult ? (
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <StatusCard label="Pages crawled" value={crawlResult.pagesCrawled.toString()} />
              <StatusCard label="Chunks created" value={crawlResult.chunksCreated.toString()} />
              <StatusCard label="Indexed site" value={new URL(crawlResult.rootUrl).hostname} />
            </div>
          ) : null}

          {crawlResult && (crawlResult.warnings.length > 0 || crawlResult.errors.length > 0) ? (
            <details className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <summary className="cursor-pointer font-semibold">Crawl warnings and errors</summary>
              <ul className="mt-3 list-disc space-y-1 pl-5">
                {[...crawlResult.warnings, ...crawlResult.errors].map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>

        {crawlResult ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold">Ask questions</h2>
                <p className="mt-1 text-sm text-slate-500">Answers are constrained to the retrieved website excerpts.</p>
              </div>
            </div>

            <div
              ref={chatContainerRef}
              role="log"
              aria-live="polite"
              className="mt-6 flex min-h-80 max-h-[500px] flex-col gap-4 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-4"
            >
              {messages.length === 0 ? (
                <div className="flex flex-1 items-center justify-center text-center text-slate-500">
                  Try asking what the site says about pricing, features, policies, docs, or contact information.
                </div>
              ) : (
                messages.map((message, index) => <MessageBubble key={index} message={message} />)
              )}
              {isAnswering && messages[messages.length - 1]?.content === "" ? (
                <div className="text-sm text-slate-500" aria-live="polite">Searching excerpts and drafting a grounded answer...</div>
              ) : null}
            </div>

            {chatError ? (
              <div role="alert" className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{chatError}</div>
            ) : null}

            <form onSubmit={handleAsk} className="mt-4 flex flex-col gap-3 md:flex-row">
              <input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Ask a question about the crawled site..."
                aria-label="Your question"
                className="min-h-12 flex-1 rounded-2xl border border-slate-300 px-4 outline-none transition focus:border-slate-950 focus:ring-4 focus:ring-slate-200"
              />
              <button
                type="submit"
                disabled={isAnswering || !question.trim()}
                className="min-h-12 rounded-2xl bg-slate-950 px-6 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isAnswering ? "Answering..." : "Ask"}
              </button>
            </form>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function StatusCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 truncate text-2xl font-bold">{value}</div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const [expandedExcerpts, setExpandedExcerpts] = useState<Set<string>>(new Set());

  function toggleExcerpt(url: string) {
    setExpandedExcerpts((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  }

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-3xl rounded-2xl p-4 ${isUser ? "bg-slate-950 text-white" : "bg-white text-slate-900 shadow-sm"}`}>
        <div className="whitespace-pre-wrap text-sm leading-6">{message.content}</div>
        {!isUser && message.sources && message.sources.length > 0 ? (
          <div className="mt-4 border-t border-slate-200 pt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sources</div>
            <ul className="mt-2 space-y-2 text-sm">
              {message.sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noreferrer" className="text-blue-700 underline underline-offset-2">
                    {source.title || source.url}
                  </a>
                  {source.excerpt ? (
                    <>
                      <button
                        onClick={() => toggleExcerpt(source.url)}
                        className="ml-2 text-xs text-slate-400 hover:text-slate-600 transition"
                        aria-label={expandedExcerpts.has(source.url) ? "Hide excerpt" : "Show excerpt"}
                      >
                        {expandedExcerpts.has(source.url) ? "▾ hide" : "▸ excerpt"}
                      </button>
                      {expandedExcerpts.has(source.url) ? (
                        <blockquote className="mt-1 border-l-2 border-slate-200 pl-3 text-xs text-slate-500 leading-5">
                          {source.excerpt}
                        </blockquote>
                      ) : null}
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
