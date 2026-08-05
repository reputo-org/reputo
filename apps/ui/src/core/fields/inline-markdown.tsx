"use client"

import ReactMarkdown from "react-markdown"

/**
 * Registry copy is Markdown, so inline code and emphasis must render rather
 * than leak their markers. Paragraphs unwrap because callers already supply
 * the block element (`FormDescription` renders a `<p>`, which cannot nest one).
 */
export function InlineMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      components={{
        p: ({ children: content }) => <>{content}</>,
        code: ({ children: content }) => (
          <code className="bg-muted rounded px-1 py-0.5 font-mono text-[0.9em]">
            {content}
          </code>
        ),
        a: ({ children: content, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            {content}
          </a>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  )
}
