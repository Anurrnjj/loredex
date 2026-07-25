"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { KindIcon, VisibilityBadge } from "@/components/doc-bits";
import type { SearchHit } from "@/lib/queries";
import { cn, formatDate } from "@/lib/utils";

/**
 * Results list with keyboard navigation: ↑/↓ to move, Enter to open.
 *
 * A search tool you have to reach for the mouse in is a search tool you stop
 * using, so this is not a nice-to-have.
 */
export function SearchResults({ hits }: { hits: SearchHit[] }) {
  const [active, setActive] = useState(0);
  const [renderedHits, setRenderedHits] = useState(hits);
  const listRef = useRef<HTMLUListElement>(null);
  const router = useRouter();

  // A new result set moves the selection back to the top. Adjusted during
  // render rather than in an effect — React re-runs this component immediately
  // without committing the stale selection, so there is no flash of the old
  // row being highlighted and no cascading render.
  if (renderedHits !== hits) {
    setRenderedHits(hits);
    setActive(0);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if (e.key === "ArrowDown" || (e.key === "j" && !typing)) {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, hits.length - 1));
      } else if (e.key === "ArrowUp" || (e.key === "k" && !typing)) {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && !typing && hits[active]) {
        e.preventDefault();
        router.push(`/d/${hits[active].id}`);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hits, active, router]);

  useEffect(() => {
    listRef.current
      ?.querySelectorAll("li")
      [active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <ul ref={listRef} className="mt-2 divide-y divide-border">
      {hits.map((hit, i) => (
        <li key={hit.id}>
          <Link
            href={`/d/${hit.id}`}
            onMouseEnter={() => setActive(i)}
            className={cn(
              "block rounded-lg px-3 py-4 transition-colors",
              i === active ? "bg-surface-hover" : "hover:bg-surface-hover",
            )}
          >
            <div className="flex items-center gap-2">
              <KindIcon kind={hit.kind} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {hit.title}
              </span>
              <VisibilityBadge visibility={hit.visibility} />
            </div>

            {hit.snippet && (
              <p
                className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-fg-muted"
                // ts_headline returns only the <mark> tags we asked it for;
                // everything else is escaped by Postgres.
                dangerouslySetInnerHTML={{ __html: hit.snippet }}
              />
            )}

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
              {hit.collectionName && <span>{hit.collectionName}</span>}
              {hit.tags.length > 0 && <span>{hit.tags.join(" · ")}</span>}
              <span className="font-mono">{hit.originalFilename}</span>
              <span>{formatDate(hit.createdAt)}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
