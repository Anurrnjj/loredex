import Link from "next/link";

import { KindIcon, StatusPill, TagChip } from "@/components/doc-bits";
import { SearchBox } from "@/components/search-box";
import { requireUserId } from "@/lib/auth";
import { recentDocuments, topTags } from "@/lib/queries";
import { formatBytes, formatDate } from "@/lib/utils";

/**
 * Search-first by design. The box sits high on an otherwise empty page; recent
 * documents and tags live below it. Resisting the urge to build a dashboard
 * here is the point — you came to find something.
 */
export default async function HomePage() {
  const userId = await requireUserId();
  const [recent, tags] = await Promise.all([
    recentDocuments(userId, 8),
    topTags(userId, 20),
  ]);

  const isEmpty = recent.length === 0;

  return (
    <main className="mx-auto max-w-3xl px-4 pb-24 sm:px-6">
      <section className="flex flex-col items-center pt-[18vh]">
        <h1 className="mb-6 text-center text-2xl font-semibold tracking-tight">
          What are you trying to remember?
        </h1>
        <SearchBox large autoFocus />
        <p className="mt-3 text-center text-sm text-fg-subtle">
          Searches inside your documents, not just their names.
        </p>
      </section>

      {isEmpty ? (
        <section className="mt-20 rounded-xl border border-dashed border-border p-10 text-center">
          <h2 className="text-sm font-medium">Nothing here yet</h2>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-fg-muted">
            Upload a doc, a prompt guide, or a zip from an old project. Loredex
            reads what is inside it so you can find it later.
          </p>
          <Link
            href="/upload"
            className="mt-5 inline-flex rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
          >
            Upload your first doc
          </Link>
        </section>
      ) : (
        <>
          {tags.length > 0 && (
            <section className="mt-20">
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-fg-subtle">
                Tags
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <TagChip
                    key={t.name}
                    name={`${t.name} · ${t.count}`}
                    href={`/search?q=${encodeURIComponent(t.name)}&tag=${encodeURIComponent(t.name)}`}
                  />
                ))}
              </div>
            </section>
          )}

          <section className="mt-12">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-fg-subtle">
              Recent
            </h2>
            <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
              {recent.map((doc) => (
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
                      {doc.collectionName ?? formatBytes(doc.sizeBytes)}
                    </span>
                    <span className="hidden w-20 text-right text-xs text-fg-subtle md:inline">
                      {formatDate(doc.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
