"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The search box. On the home page it is the whole interface, so it gets the
 * `large` treatment; on the results page it sits at the top.
 *
 * `/` focuses it from anywhere, matching the convention in every developer
 * tool this app sits alongside.
 */
export function SearchBox({
  initialQuery = "",
  large = false,
  autoFocus = false,
}: {
  initialQuery?: string;
  large?: boolean;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typingElsewhere =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if (e.key === "/" && !typingElsewhere) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = value.trim();
    if (q) router.push(`/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <form onSubmit={submit} role="search" className="w-full">
      <div className="relative">
        <Search
          className={cn(
            "pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-fg-subtle",
            large ? "size-5" : "size-4",
          )}
          aria-hidden
        />
        <input
          ref={inputRef}
          type="search"
          name="q"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus={autoFocus}
          placeholder="Search your docs, guides, and archives…"
          aria-label="Search documents"
          className={cn(
            "w-full rounded-xl border border-border bg-surface text-fg placeholder:text-fg-subtle",
            "transition-colors hover:border-border-strong focus:border-accent",
            large
              ? "py-4 pl-12 pr-16 text-base"
              : "py-2.5 pl-10 pr-14 text-sm",
          )}
        />
        <kbd
          className={cn(
            "pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 rounded border border-border",
            "bg-surface-hover px-1.5 py-0.5 font-mono text-[11px] text-fg-subtle sm:block",
          )}
        >
          /
        </kbd>
      </div>
    </form>
  );
}
