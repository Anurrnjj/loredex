import { eq } from "drizzle-orm";

import { db } from "@/db";
import { zipEntries, type Document } from "@/db/schema";
import { CodeView } from "@/components/viewers/code-view";
import { MarkdownView } from "@/components/viewers/markdown-view";
import { OfficeView } from "@/components/viewers/office-view";
import { PdfView } from "@/components/viewers/pdf-view";
import { ZipView } from "@/components/viewers/zip-view";
import { getDocumentContent } from "@/lib/queries";

/**
 * Picks the renderer for a document and hands it what it needs.
 *
 * Everything except the PDF iframe and the zip tree renders on the server, so
 * the reading experience does not depend on client JavaScript.
 */
export async function DocumentView({ doc }: { doc: Document }) {
  const fileHref = `/api/files/${doc.id}`;
  const downloadHref = `${fileHref}?download=1`;

  if (doc.status === "failed") {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger-subtle p-6">
        <h2 className="text-sm font-medium text-danger">
          This document could not be processed
        </h2>
        <p className="mt-1.5 text-sm text-fg-muted">
          {doc.failureReason ??
            "Extraction failed for an unknown reason."}{" "}
          The original file is intact and can still be downloaded.
        </p>
        <a
          href={downloadHref}
          className="mt-4 inline-flex rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium"
        >
          Download original
        </a>
      </div>
    );
  }

  if (doc.status !== "ready") {
    return (
      <div className="rounded-lg border border-border bg-surface p-10 text-center">
        <span className="mx-auto mb-3 block size-2 animate-pulse rounded-full bg-warn" />
        <h2 className="text-sm font-medium">Still processing</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Loredex is reading this file so it becomes searchable. Refresh in a
          moment.
        </p>
      </div>
    );
  }

  const content = await getDocumentContent(doc.id);

  switch (doc.kind) {
    case "markdown":
      return <MarkdownView source={content?.extractedText ?? ""} />;

    case "code":
    case "text":
      return (
        <CodeView
          source={content?.extractedText ?? ""}
          filename={doc.originalFilename}
        />
      );

    case "pdf":
      return (
        <PdfView
          src={fileHref}
          title={doc.title}
          downloadHref={downloadHref}
        />
      );

    case "office":
      return (
        <OfficeView
          documentId={doc.id}
          title={doc.title}
          previewKey={content?.previewKey ?? null}
          previewMime={content?.previewMime ?? null}
          downloadHref={downloadHref}
        />
      );

    case "archive": {
      const entries = await db
        .select({
          path: zipEntries.path,
          sizeBytes: zipEntries.sizeBytes,
          isDirectory: zipEntries.isDirectory,
          isText: zipEntries.isText,
          textPreview: zipEntries.textPreview,
        })
        .from(zipEntries)
        .where(eq(zipEntries.documentId, doc.id))
        .orderBy(zipEntries.path);

      if (entries.length === 0) {
        return (
          <EmptyPreview downloadHref={downloadHref} label="empty archive" />
        );
      }
      return <ZipView entries={entries} />;
    }

    default:
      return <EmptyPreview downloadHref={downloadHref} label="file type" />;
  }
}

function EmptyPreview({
  downloadHref,
  label,
}: {
  downloadHref: string;
  label: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border p-10 text-center">
      <p className="text-sm text-fg-muted">
        No inline preview for this {label}.
      </p>
      <a
        href={downloadHref}
        className="mt-4 inline-flex rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg"
      >
        Download
      </a>
    </div>
  );
}
