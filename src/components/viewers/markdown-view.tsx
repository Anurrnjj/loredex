import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { highlightCode } from "@/lib/highlight";

/**
 * Renders Markdown as a server component.
 *
 * Code blocks are highlighted on the server, so no highlighter bundle reaches
 * the browser and the page is coloured on first paint. Headings get stable IDs
 * so the outline in the sidebar can link into them.
 */
export async function MarkdownView({ source }: { source: string }) {
  // react-markdown's components map cannot be async, so every fenced block is
  // highlighted up front and looked up by content during render.
  const blocks = new Map<string, string>();
  const fenceRe = /```([\w+-]*)\n([\s\S]*?)```/g;
  for (const match of source.matchAll(fenceRe)) {
    const [, lang, code] = match;
    if (!lang) continue;
    const html = await highlightCode(code.replace(/\n$/, ""), lang.toLowerCase());
    if (html) blocks.set(code.replace(/\n$/, ""), html);
  }

  return (
    <div className="prose-loredex">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props) => <h1 id={slugFromChildren(props.children)} {...props} />,
          h2: (props) => <h2 id={slugFromChildren(props.children)} {...props} />,
          h3: (props) => <h3 id={slugFromChildren(props.children)} {...props} />,
          // Wide tables scroll in their own box; the page body never does.
          table: (props) => (
            <div className="table-wrap">
              <table {...props} />
            </div>
          ),
          a: (props) => (
            <a {...props} rel="noopener noreferrer nofollow" target="_blank" />
          ),
          pre: ({ children }) => {
            const code = extractCode(children);
            const html = code ? blocks.get(code) : undefined;
            if (html) {
              return (
                <div
                  className="shiki-block"
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              );
            }
            return <pre>{children}</pre>;
          },
        }}
      >
        {source}
      </Markdown>
    </div>
  );
}

function extractCode(children: React.ReactNode): string | null {
  if (
    children &&
    typeof children === "object" &&
    "props" in children &&
    children.props
  ) {
    const inner = (children.props as { children?: unknown }).children;
    if (typeof inner === "string") return inner.replace(/\n$/, "");
  }
  return null;
}

export function slugFromChildren(children: React.ReactNode): string {
  const text = flatten(children);
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function flatten(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flatten).join("");
  if (node && typeof node === "object" && "props" in node) {
    return flatten((node.props as { children?: React.ReactNode }).children);
  }
  return "";
}

/** Headings for the sidebar outline, parsed from the raw source. */
export function outlineOf(source: string) {
  const headings: Array<{ level: number; text: string; id: string }> = [];
  const lines = source.split("\n");
  let inFence = false;

  for (const line of lines) {
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const m = /^(#{1,3})\s+(.+?)\s*#*$/.exec(line);
    if (m) {
      const text = m[2].replace(/[*_`]/g, "");
      headings.push({
        level: m[1].length,
        text,
        id: text
          .toLowerCase()
          .replace(/[^\w\s-]/g, "")
          .trim()
          .replace(/\s+/g, "-"),
      });
    }
  }
  return headings;
}
