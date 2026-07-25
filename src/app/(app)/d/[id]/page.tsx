import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";

import { DocumentView } from "@/components/document-view";
import { KindIcon, TagChip, kindLabel } from "@/components/doc-bits";
import { VisibilityControl } from "@/components/visibility-control";
import { getReadableDocument } from "@/lib/access";
import { requireUserId } from "@/lib/auth";
import { documentTagNames, getDocumentContent } from "@/lib/queries";
import { formatBytes, formatDate } from "@/lib/utils";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const doc = await getReadableDocument(id, await requireUserId());
  return { title: doc?.title ?? "Document" };
}

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const userId = await requireUserId();

  const doc = await getReadableDocument(id, userId);
  if (!doc) notFound();

  const [tags, content] = await Promise.all([
    documentTagNames(doc.id),
    getDocumentContent(doc.id),
  ]);

  const isOwner = doc.ownerId === userId;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link
        href="/search"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-3.5" />
        Back to search
      </Link>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <article className="min-w-0">
          <header className="mb-6">
            <div className="flex items-center gap-2 text-xs text-fg-subtle">
              <KindIcon kind={doc.kind} />
              <span>{kindLabel(doc.kind)}</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              {doc.title}
            </h1>
            {doc.description && (
              <p className="mt-2 text-sm text-fg-muted">{doc.description}</p>
            )}
          </header>

          <DocumentView doc={doc} />
        </article>

        {/* Sticky on wide screens, stacked underneath on narrow ones. */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <dl className="space-y-4 rounded-xl border border-border bg-surface p-4 text-sm">
            <Row label="File">
              <span className="break-all font-mono text-xs">
                {doc.originalFilename}
              </span>
            </Row>
            <Row label="Size">{formatBytes(doc.sizeBytes)}</Row>
            {content?.pageCount ? (
              <Row label="Pages">{content.pageCount}</Row>
            ) : null}
            <Row label="Added">{formatDate(doc.createdAt)}</Row>

            <Row label="Visibility">
              {isOwner ? (
                <VisibilityControl
                  documentId={doc.id}
                  current={doc.visibility}
                />
              ) : (
                <span className="capitalize">{doc.visibility}</span>
              )}
            </Row>

            {tags.length > 0 && (
              <Row label="Tags">
                <span className="flex flex-wrap gap-1">
                  {tags.map((t) => (
                    <TagChip
                      key={t}
                      name={t}
                      href={`/search?q=${encodeURIComponent(t)}&tag=${encodeURIComponent(t)}`}
                    />
                  ))}
                </span>
              </Row>
            )}
          </dl>

          <a
            href={`/api/files/${doc.id}?download=1`}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium transition-colors hover:bg-surface-hover"
          >
            <Download className="size-3.5" />
            Download original
          </a>
        </aside>
      </div>
    </main>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
        {label}
      </dt>
      <dd className="text-fg">{children}</dd>
    </div>
  );
}
