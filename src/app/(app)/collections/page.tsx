import Link from "next/link";
import { FolderOpen } from "lucide-react";

import { requireUserId } from "@/lib/auth";
import { listCollections } from "@/lib/queries";

export const metadata = { title: "Collections" };

export default async function CollectionsPage() {
  const userId = await requireUserId();
  const collections = await listCollections(userId);

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <header className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Collections</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Documents grouped by the project they came from.
        </p>
      </header>

      {collections.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <h2 className="text-sm font-medium">No collections yet</h2>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-fg-muted">
            Name a collection while uploading and it appears here — useful for
            keeping one old project&apos;s docs together.
          </p>
          <Link
            href="/upload"
            className="mt-5 inline-flex text-sm text-accent underline underline-offset-2"
          >
            Upload a document
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {collections.map((c) => (
            <li key={c.id}>
              <Link
                href={`/collections/${c.slug}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
              >
                <FolderOpen className="size-4 text-fg-subtle" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {c.name}
                  </span>
                  {c.description && (
                    <span className="block truncate text-xs text-fg-subtle">
                      {c.description}
                    </span>
                  )}
                </span>
                <span className="text-xs text-fg-subtle">
                  {c.count} {c.count === 1 ? "doc" : "docs"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
