import { notFound } from "next/navigation";
import Link from "next/link";
import { Library } from "lucide-react";

import { DocumentView } from "@/components/document-view";
import { KindIcon, kindLabel } from "@/components/doc-bits";
import { getReadableDocument } from "@/lib/access";
import { getUserId } from "@/lib/auth";
import { documentTagNames } from "@/lib/queries";
import { formatBytes, formatDate } from "@/lib/utils";

/**
 * Public read-only view of a shared document.
 *
 * Outside the (app) route group and listed as public in proxy.ts, so it works
 * signed out. `getReadableDocument` with a null viewer resolves only public and
 * unlisted documents — a private one 404s exactly like a nonexistent ID.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const doc = await getReadableDocument(id, await getUserId());
  if (!doc || doc.visibility === "private") return { title: "Not found" };
  return {
    title: doc.title,
    description: doc.description ?? undefined,
    // Unlisted means "reachable by link", not "please index me".
    robots: doc.visibility === "public" ? undefined : { index: false },
  };
}

export default async function PublicDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewerId = await getUserId();

  const doc = await getReadableDocument(id, viewerId);
  if (!doc || doc.visibility === "private") notFound();

  const tags = await documentTagNames(doc.id);

  return (
    <>
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-semibold tracking-tight"
          >
            <Library className="size-4 text-accent" aria-hidden />
            Loredex
          </Link>
          <span className="text-xs text-fg-subtle">Shared document</span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <div className="mb-6">
          <div className="flex items-center gap-2 text-xs text-fg-subtle">
            <KindIcon kind={doc.kind} />
            <span>{kindLabel(doc.kind)}</span>
            <span aria-hidden>·</span>
            <span>{formatBytes(doc.sizeBytes)}</span>
            <span aria-hidden>·</span>
            <span>{formatDate(doc.createdAt)}</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            {doc.title}
          </h1>
          {doc.description && (
            <p className="mt-2 text-sm text-fg-muted">{doc.description}</p>
          )}
          {tags.length > 0 && (
            <p className="mt-2 text-xs text-fg-subtle">{tags.join(" · ")}</p>
          )}
        </div>

        <DocumentView doc={doc} />
      </main>
    </>
  );
}
