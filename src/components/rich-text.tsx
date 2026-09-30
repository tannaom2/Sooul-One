import Link from "next/link";
import { parseMarkdown, type Inline } from "@/lib/mini-markdown";

/** An article body (src/lib/mini-markdown.ts) as React elements. Text is never parsed as HTML. */
export function RichText({ source }: { source: string }) {
  return (
    <div className="grid gap-4 text-base leading-relaxed">
      {parseMarkdown(source).map((block, i) => {
        switch (block.type) {
          case "h2":
            return (
              <h2 key={i} className="mt-4 text-h3 font-bold">
                <Inlines content={block.content} />
              </h2>
            );
          case "h3":
            return (
              <h3 key={i} className="mt-2 text-lead font-bold">
                <Inlines content={block.content} />
              </h3>
            );
          case "quote":
            return (
              <blockquote key={i} className="border-l-4 border-rule pl-4 text-ink-soft">
                <Inlines content={block.content} />
              </blockquote>
            );
          case "ul":
          case "ol": {
            const List = block.type;
            return (
              <List key={i} className={`grid gap-1.5 pl-6 ${block.type === "ul" ? "list-disc" : "list-decimal"}`}>
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Inlines content={item} />
                  </li>
                ))}
              </List>
            );
          }
          default:
            return (
              <p key={i}>
                <Inlines content={block.content} />
              </p>
            );
        }
      })}
    </div>
  );
}

function Inlines({ content }: { content: readonly Inline[] }) {
  return (
    <>
      {content.map((c, i) =>
        c.type === "bold" ? (
          <strong key={i}>{c.text}</strong>
        ) : c.type === "link" ? (
          c.href.startsWith("/") ? (
            <Link key={i} href={c.href} className="underline underline-offset-2">
              {c.text}
            </Link>
          ) : (
            <a key={i} href={c.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              {c.text}
            </a>
          )
        ) : (
          <span key={i}>{c.text}</span>
        ),
      )}
    </>
  );
}
