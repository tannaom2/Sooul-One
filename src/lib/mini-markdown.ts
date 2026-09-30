/**
 * The small Markdown subset /learn articles are written in, parsed to plain
 * data that src/components/rich-text.tsx renders as React elements. No HTML
 * is ever passed through: whatever is typed is shown as text, so an article
 * can't carry a script. Pure, so it's tested (tests/mini-markdown.test.ts).
 *
 * Supported: "## Heading" and "### Subheading", paragraphs (blank line
 * between), "- item" bullet lists, "1. item" numbered lists, "> quote",
 * **bold**, and [links](/path) to this site or https:// addresses.
 */

export type Inline =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "bold"; readonly text: string }
  | { readonly type: "link"; readonly text: string; readonly href: string };

export type Block =
  | { readonly type: "h2" | "h3" | "p" | "quote"; readonly content: readonly Inline[] }
  | { readonly type: "ul" | "ol"; readonly items: readonly (readonly Inline[])[] };

/** Only paths on this site and https addresses are links; anything else stays text. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^\/(?!\/)/.test(h)) return h;
  try {
    const url = new URL(h);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ type: "bold", text: m[1] });
    else {
      const href = safeHref(m[3]);
      out.push(href ? { type: "link", text: m[2], href } : { type: "text", text: m[0] });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  let list: { type: "ul" | "ol"; items: Inline[][] } | null = null;

  const flush = () => {
    if (para.length) blocks.push({ type: "p", content: parseInline(para.join(" ")) });
    para = [];
    if (list) blocks.push(list);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = /^(#{2,3})\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: heading[1].length === 2 ? "h2" : "h3", content: parseInline(heading[2]) });
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.+)$/.exec(line);
    if (bullet || numbered) {
      const type = bullet ? "ul" : "ol";
      if (para.length || (list && list.type !== type)) flush();
      list ??= { type, items: [] };
      list.items.push(parseInline((bullet ?? numbered)![1]));
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flush();
      blocks.push({ type: "quote", content: parseInline(quote[1]) });
      continue;
    }
    if (list) flush();
    para.push(line);
  }
  flush();
  return blocks;
}

/** The article's text without any markup, for the claims check and search. */
export function plainText(source: string): string {
  return parseMarkdown(source)
    .flatMap((b) => ("content" in b ? [b.content] : b.items))
    .map((inl) => inl.map((i) => i.text).join(""))
    .join("\n");
}
