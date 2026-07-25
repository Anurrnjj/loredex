"use client";

import { useState, useTransition } from "react";
import { Check, Copy } from "lucide-react";

import { setVisibility } from "@/app/actions/documents";
import type { Visibility } from "@/db/schema";

/**
 * Owner-only visibility switch, plus a copy-link affordance once the document
 * is shareable. Optimistic on the label, authoritative on the server — the
 * action re-checks ownership regardless of what this component sends.
 */
export function VisibilityControl({
  documentId,
  current,
}: {
  documentId: string;
  current: Visibility;
}) {
  const [value, setValue] = useState<Visibility>(current);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  function onChange(next: Visibility) {
    const previous = value;
    setValue(next);
    startTransition(async () => {
      try {
        await setVisibility(documentId, next);
      } catch {
        setValue(previous);
      }
    });
  }

  async function copyLink() {
    await navigator.clipboard.writeText(
      `${window.location.origin}/p/${documentId}`,
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-2">
      <select
        value={value}
        disabled={pending}
        onChange={(e) => onChange(e.target.value as Visibility)}
        aria-label="Document visibility"
        className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm disabled:opacity-60"
      >
        <option value="private">Private — only me</option>
        <option value="unlisted">Unlisted — anyone with the link</option>
        <option value="public">Public — searchable by everyone</option>
      </select>

      {value !== "private" && (
        <button
          type="button"
          onClick={copyLink}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          {copied ? (
            <>
              <Check className="size-3" /> Copied
            </>
          ) : (
            <>
              <Copy className="size-3" /> Copy share link
            </>
          )}
        </button>
      )}
    </div>
  );
}
