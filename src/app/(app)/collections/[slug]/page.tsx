import { notFound } from "next/navigation";
import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { collections, documents } from "@/db/schema";
import { KindIcon, StatusPill } from "@/components/doc-bits";
import { requireUserId } from "@/lib/auth";
import { formatBytes, formatDate } from "@/lib/utils";

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const userId = await requireUserId();

  const [collection] = await db
    .select()
    .from(collections)
    .where(and(eq(collections.ownerId, userId), eq(collections.slug, slug)))
    .limit(1);

  if (!collection) notFound();

  const docs = await db
    .select({
      id: documents.id,
      title: documents.title,
      kind: documents.kind,
      status: documents.status,
      sizeBytes: documents.sizeBytes,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(eq(documents.collectionId, collection.id))
    .orderBy(desc(documents.createdAt));

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Link
        href="/collections"
        className="mb-6 inline-block text-sm text-fg-muted transition-colors hover:text-fg"
      >
        ← Collections
      </Link>

      <h1 className="text-xl font-semibold tracking-tight">
        {collection.name}
      </h1>
      <p className="mt-1 text-sm text-fg-muted">
        {docs.length} {docs.length === 1 ? "document" : "documents"}
      </p>

      <ul className="mt-8 divide-y divide-border rounded-xl border border-border bg-surface">
        {docs.map((doc) => (
          <li key={doc.id}>
            <Link
              href={`/d/${doc.id}`}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
            >
              <KindIcon kind={doc.kind} />
              <span className="min-w-0 flex-1 truncate text-sm">
                {doc.title}
              </span>
              <StatusPill status={doc.status} />
              <span className="hidden text-xs text-fg-subtle sm:inline">
                {formatBytes(doc.sizeBytes)}
              </span>
              <span className="hidden w-20 text-right text-xs text-fg-subtle md:inline">
                {formatDate(doc.createdAt)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
