"use client";

import { useState } from "react";
import { Download, ExternalLink } from "lucide-react";

/**
 * PDF rendering, delegated to the browser's built-in viewer via an <iframe>.
 *
 * Deliberately not react-pdf: it ships a ~400 KB worker bundle, needs its own
 * font and canvas assets, and re-implements pagination, search, and zoom that
 * every browser already provides natively and accessibly. The tradeoff is that
 * the in-page toolbar is the browser's rather than ours, which for a reference
 * library is fine.
 *
 * The `src` is our /api/files route, which authorizes and then redirects to a
 * short-lived presigned URL.
 */
export function PdfView({
  src,
  title,
  downloadHref,
}: {
  src: string;
  title: string;
  downloadHref: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="rounded-lg border border-border bg-surface p-10 text-center">
        <p className="text-sm text-fg-muted">
          This PDF could not be displayed inline.
        </p>
        <a
          href={downloadHref}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg"
        >
          <Download className="size-3.5" />
          Download it instead
        </a>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="truncate text-xs text-fg-subtle">{title}</span>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
        >
          <ExternalLink className="size-3" />
          Open in new tab
        </a>
      </div>
      <iframe
        src={src}
        title={title}
        onError={() => setFailed(true)}
        className="h-[80vh] w-full bg-white"
      />
    </div>
  );
}
