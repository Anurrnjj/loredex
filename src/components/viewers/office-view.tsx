import { getObjectBuffer } from "@/lib/s3";
import { PdfView } from "./pdf-view";

/**
 * Office documents, rendered from the preview the worker cached at ingest.
 *
 *  - .docx and .xlsx became sanitized HTML (mammoth / SheetJS)
 *  - .pptx and the legacy binary formats became a PDF (LibreOffice)
 *
 * Nothing is converted at request time — that work happened once, in the
 * worker, so opening a document is a read rather than a conversion.
 */
export async function OfficeView({
  documentId,
  title,
  previewKey,
  previewMime,
  downloadHref,
}: {
  documentId: string;
  title: string;
  previewKey: string | null;
  previewMime: string | null;
  downloadHref: string;
}) {
  if (!previewKey) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center">
        <p className="text-sm text-fg-muted">
          No preview was generated for this file.
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

  if (previewMime === "application/pdf") {
    return (
      <PdfView
        src={`/api/files/${documentId}?preview=1`}
        title={title}
        downloadHref={downloadHref}
      />
    );
  }

  // The HTML was sanitized with DOMPurify in the worker, before it was ever
  // written to storage — see src/worker/extractors.ts.
  const html = (await getObjectBuffer(previewKey)).toString("utf8");

  return (
    <div className="prose-loredex">
      <div
        className="[&_table]:w-full [&_table_td]:border [&_table_td]:border-border [&_table_td]:px-2 [&_table_td]:py-1"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
