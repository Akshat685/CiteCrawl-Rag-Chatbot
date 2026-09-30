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
      const data = (await response.json()) as CrawlApiResponse & { error?: string };

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
    if (!trimmedQuestion || !siteId) return;

    setChatError(null);
    setQuestion("");
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

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream.");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "token") {
              setMessages((current) => {
                const updated = [...current];
                const last = updated[updated.length - 1];
                if (last?.role === "assistant") {
                  updated[updated.length - 1] = { ...last, content: last.content + event.content };
                }
                return updated;
              });
            } else if (event.type === "done") {
              setMessages((current) => {
                const updated = [...current];
                const last = updated[updated.length - 1];
                if (last?.role === "assistant") {
                  updated[updated.length - 1] = { ...last, sources: event.sources };
                }
                return updated;
              });
            } else if (event.type === "error") {
              setChatError(event.error);
            }
          } catch {
            /* skip malformed */
          }
        }
      }
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Failed to answer question.");
      setMessages((current) => {
        const last = current[current.length - 1];
        if (last?.role === "assistant" && !last.content) return current.slice(0, -1);
        return current;
      });
    } finally {
      setIsAnswering(false);
    }
  }

  return (
    <main className="min-h-screen px-4 py-8 md:py-12">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">

        {/* ── Hero ──────────────────────────────────────────────── */}
        <section className="glass-card p-8 animate-hero-enter">
          <span className="tag-eyebrow">Crawl + RAG</span>
          <h1 className="mt-4 text-4xl md:text-5xl font-bold tracking-tight gradient-text leading-tight">
            Chat with any Website
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed" style={{ color: "var(--text-2)" }}>
            Paste a URL, crawl up to 10 pages, and ask grounded questions.
            Every answer comes with source links back to the original content.
          </p>
        </section>

        {/* ── Crawl Form ───────────────────────────────────────── */}
        <section className="glass-card p-6 animate-section-enter" style={{ animationDelay: "150ms" }}>
          <form onSubmit={handleCrawl} className="flex flex-col gap-4 md:flex-row">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              type="url"
              required
              placeholder="https://example.com"
              aria-label="Website URL to crawl"
              className="input-glass flex-1"
            />
            <button
              type="submit"
              disabled={isCrawling}
              className={`btn-primary ${isCrawling ? "animate-pulse-glow" : ""}`}
            >
              {isCrawling ? (
                <span className="flex items-center gap-2">
                  <Spinner />
                  Crawling…
                </span>
              ) : (
                "Crawl site"
              )}
            </button>
          </form>

          <p className="mt-3 text-xs" style={{ color: "var(--text-3)" }}>
            Max 10 pages · Depth 2 · Polite delay between requests
          </p>

          {crawlError && (
            <div role="alert" className="banner-error mt-4">{crawlError}</div>
          )}

          {crawlResult && (
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <StatusCard label="Pages crawled" value={crawlResult.pagesCrawled.toString()} delay={0} />
              <StatusCard label="Chunks created" value={crawlResult.chunksCreated.toString()} delay={1} />
              <StatusCard label="Indexed site" value={new URL(crawlResult.rootUrl).hostname} delay={2} />
            </div>
          )}

          {crawlResult && (crawlResult.warnings.length > 0 || crawlResult.errors.length > 0) && (
            <details className="banner-warning mt-4">
              <summary className="cursor-pointer font-semibold text-sm">
                Crawl warnings and errors ({crawlResult.warnings.length + crawlResult.errors.length})
              </summary>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm" style={{ color: "var(--amber-text)", opacity: 0.8 }}>
                {[...crawlResult.warnings, ...crawlResult.errors].map((item, i) => (
                  <li key={`${item}-${i}`}>{item}</li>
                ))}
              </ul>
            </details>
          )}
        </section>

        {/* ── Chat Section ─────────────────────────────────────── */}
        {crawlResult && (
          <section className="glass-card p-6 animate-section-enter" style={{ animationDelay: "300ms" }}>
            <div>
              <h2 className="text-2xl font-bold">Ask questions</h2>
              <p className="mt-1 text-sm" style={{ color: "var(--text-3)" }}>
                Answers are grounded in the crawled content. Sources are cited.
              </p>
            </div>

            <div
              ref={chatContainerRef}
              role="log"
              aria-live="polite"
              className="chat-container mt-5 flex min-h-[320px] max-h-[500px] flex-col gap-4 overflow-y-auto p-4"
            >
              {messages.length === 0 ? (
                <div className="flex flex-1 items-center justify-center text-center text-sm" style={{ color: "var(--text-3)" }}>
                  <div>
                    <div className="text-3xl mb-3">💬</div>
                    Ask about pricing, features, docs, policies, or anything on the site.
                  </div>
                </div>
              ) : (
                messages.map((msg, i) => (
                  <MessageBubble
                    key={i}
                    message={msg}
                    isStreaming={isAnswering && i === messages.length - 1 && msg.role === "assistant" && !msg.sources}
                  />
                ))
              )}
            </div>

            {chatError && (
              <div role="alert" className="banner-error mt-4">{chatError}</div>
            )}

            <form onSubmit={handleAsk} className="mt-4 flex flex-col gap-3 md:flex-row">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask a question about the crawled site…"
                aria-label="Your question"
                className="input-glass flex-1"
              />
              <button
                type="submit"
                disabled={isAnswering || !question.trim()}
                className="btn-primary"
              >
                {isAnswering ? (
                  <span className="flex items-center gap-2">
                    <Spinner />
                    Thinking…
                  </span>
                ) : (
                  "Ask"
                )}
              </button>
            </form>
          </section>
        )}
      </div>

      {/* Footer */}
      <footer className="mt-12 pb-6 text-center text-xs" style={{ color: "var(--text-3)" }}>
        Built with Next.js · Gemini · RAG pipeline
      </footer>
    </main>
  );
}

/* ── Sub-Components ─────────────────────────────────────────── */

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function StatusCard({ label, value, delay }: { label: string; value: string; delay: number }) {
  const delayClass = delay === 0 ? "" : delay === 1 ? "animate-delay-1" : "animate-delay-2";

  return (
    <div className={`stat-card animate-fade-up ${delayClass}`}>
      <div className="text-xs font-medium" style={{ color: "var(--text-3)" }}>{label}</div>
      <div className="mt-1 text-2xl font-bold gradient-text-accent truncate">{value}</div>
    </div>
  );
}

function MessageBubble({ message, isStreaming }: { message: ChatMessage; isStreaming?: boolean }) {
  const isUser = message.role === "user";
  const [expandedExcerpts, setExpandedExcerpts] = useState<Set<string>>(new Set());

  function toggleExcerpt(url: string) {
    setExpandedExcerpts((prev) => {
      const next = new Set(prev);
      next.has(url) ? next.delete(url) : next.add(url);
      return next;
    });
  }

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} ${isUser ? "animate-slide-right" : "animate-slide-left"}`}>
      <div className={`max-w-[85%] md:max-w-2xl p-4 ${isUser ? "bubble-user" : "bubble-assistant"}`}>
        <div className={`whitespace-pre-wrap text-sm leading-relaxed ${isStreaming ? "streaming-caret" : ""}`}>
          {message.content || (isStreaming ? "" : "…")}
        </div>

        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="mt-4 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
              Sources
            </div>
            <ul className="mt-2 space-y-2 text-sm">
              {message.sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noreferrer" className="source-link">
                    {source.title || source.url}
                  </a>
                  {source.excerpt && (
                    <>
                      <button
                        onClick={() => toggleExcerpt(source.url)}
                        className="excerpt-toggle ml-2"
                        aria-label={expandedExcerpts.has(source.url) ? "Hide excerpt" : "Show excerpt"}
                      >
                        {expandedExcerpts.has(source.url) ? "▾ hide" : "▸ excerpt"}
                      </button>
                      {expandedExcerpts.has(source.url) && (
                        <blockquote className="excerpt-block">{source.excerpt}</blockquote>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
