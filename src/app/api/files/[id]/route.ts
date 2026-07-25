import { getUserId } from "@/lib/auth";
import { getReadableDocument } from "@/lib/access";
import { getDocumentContent } from "@/lib/queries";
import { presignDownload } from "@/lib/s3";

export const dynamic = "force-dynamic";

/**
 * Serves a document's bytes by redirecting to a short-lived presigned URL.
 *
 * The access check happens here; the redirect target is only minted once it
 * passes, and expires in minutes so a leaked URL has a small window. The app
 * never proxies the bytes themselves.
 *
 * `?preview=1` serves the cached converted preview (the PDF produced from a
 * .pptx, or the HTML produced from a .docx) instead of the original upload.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const viewerId = await getUserId();

  const doc = await getReadableDocument(id, viewerId);
  // Same response whether it is missing or simply not theirs — otherwise the
  // status code confirms which document IDs exist.
  if (!doc) return new Response("Not found", { status: 404 });

  const url = new URL(req.url);
  const wantPreview = url.searchParams.get("preview") === "1";
  const wantDownload = url.searchParams.get("download") === "1";

  let key = doc.storageKey;
  let filename = doc.originalFilename;

  if (wantPreview) {
    const content = await getDocumentContent(id);
    if (!content?.previewKey) {
      return new Response("No preview available", { status: 404 });
    }
    key = content.previewKey;
    filename = `${doc.title}.${content.previewMime === "application/pdf" ? "pdf" : "html"}`;
  }

  const signed = await presignDownload(key, {
    filename,
    inline: !wantDownload,
  });

  return Response.redirect(signed, 302);
}
