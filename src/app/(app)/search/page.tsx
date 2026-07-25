import Link from "next/link";

import { TagChip, kindLabel } from "@/components/doc-bits";
import { SearchBox } from "@/components/search-box";
import { SearchResults } from "@/components/search-results";
import type { DocumentKind } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { searchDocuments } from "@/lib/queries";

export const metadata = { title: "Search" };

const KINDS: DocumentKind[] = [
  "markdown",
  "pdf",
  "code",
  "text",
  "office",
  "archive",
];

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const userId = await requireUserId();
  const params = await searchParams;

  const q = str(params.q) ?? "";
  const kind = str(params.kind) as DocumentKind | undefined;
  const tag = str(params.tag);
  const scope = str(params.scope) === "mine" ? "mine" : "all";

  const hits = q
    ? await searchDocuments({ q, viewerId: userId, kind, tag, scope })
    : [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <SearchBox initialQuery={q} />

      {/* Filters are a quiet chip row, not a sidebar — they should not compete
          with the results for attention. */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <FilterChip label="All types" href={buildHref(params, { kind: undefined })} active={!kind} />
        {KINDS.map((k) => (
          <FilterChip
            key={k}
            label={kindLabel(k)}
            href={buildHref(params, { kind: k })}
            active={kind === k}
          />
        ))}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <FilterChip
          label="Everything"
          href={buildHref(params, { scope: undefined })}
          active={scope === "all"}
        />
        <FilterChip
          label="Only mine"
          href={buildHref(params, { scope: "mine" })}
          active={scope === "mine"}
        />
        {tag && (
          <>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            <FilterChip
              label={`tag: ${tag} ✕`}
              href={buildHref(params, { tag: undefined })}
              active
            />
          </>
        )}
      </div>

      {!q ? (
        <p className="mt-16 text-center text-sm text-fg-subtle">
          Type a query above. Press{" "}
          <kbd className="rounded border border-border bg-surface-hover px-1 font-mono text-[11px]">
            /
          </kbd>{" "}
          from anywhere to jump back here.
        </p>
      ) : hits.length === 0 ? (
        <div className="mt-16 text-center">
          <h2 className="text-sm font-medium">No matches for “{q}”</h2>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-fg-muted">
            Try fewer words, or drop the filters. Documents still processing are
            not searchable yet.
          </p>
          <Link
            href="/upload"
            className="mt-5 inline-flex text-sm text-accent underline underline-offset-2"
          >
            Upload something new
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-6 text-xs text-fg-subtle">
            {hits.length} {hits.length === 1 ? "result" : "results"}
          </p>
          <SearchResults hits={hits} />
        </>
      )}
    </main>
  );
}

function FilterChip({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active?: boolean;
}) {
  return <TagChip name={label} href={href} active={active} />;
}

function str(v: string | string[] | undefined) {
  return typeof v === "string" && v ? v : undefined;
}

function buildHref(
  current: Record<string, string | string[] | undefined>,
  patch: Record<string, string | undefined>,
) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if (typeof v === "string" && v) sp.set(k, v);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v) sp.set(k, v);
    else sp.delete(k);
  }
  return `/search?${sp.toString()}`;
}
