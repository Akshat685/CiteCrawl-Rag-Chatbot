import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CiteCrawl — Chat with any Website",
  description: "Crawl a website, index its content with AI, and ask grounded questions with source-cited answers."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Animated plasma background */}
        <div className="plasma-bg" aria-hidden="true">
          <div className="plasma-blob" />
          <div className="plasma-grid" />
        </div>

        {/* Main content — above the plasma layer */}
        <div style={{ position: "relative", zIndex: 1 }}>
          {children}
        </div>
        <Analytics />
      </body>
    </html>
  );
}
