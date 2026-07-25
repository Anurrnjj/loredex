import { highlightCode } from "@/lib/highlight";
import { languageOf } from "@/lib/file-kinds";

/**
 * Plain text and source files, highlighted server-side with line numbers.
 * Falls back to an unhighlighted block when the language is unknown — a
 * missing grammar should never cost you the ability to read the file.
 */
export async function CodeView({
  source,
  filename,
}: {
  source: string;
  filename: string;
}) {
  const lang = languageOf(filename);
  const html = await highlightCode(source, lang);
  const lineCount = source.split("\n").length;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs text-fg-subtle">
        <span className="font-mono">{filename}</span>
        <span>
          {lineCount} {lineCount === 1 ? "line" : "lines"}
        </span>
      </div>
      <div className="overflow-x-auto p-4 text-sm leading-relaxed">
        {html ? (
          <div
            className="shiki-block [&_pre]:!bg-transparent"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre className="whitespace-pre font-mono">{source}</pre>
        )}
      </div>
    </div>
  );
}
