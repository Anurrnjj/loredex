"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, Check, UploadCloud, X } from "lucide-react";

import { KindIcon } from "@/components/doc-bits";
import { detectKind } from "@/lib/file-kinds";
import { cn, formatBytes } from "@/lib/utils";

type Phase = "queued" | "uploading" | "processing" | "ready" | "error";

type Item = {
  key: string;
  file: File;
  title: string;
  tags: string;
  collectionName: string;
  visibility: "private" | "unlisted" | "public";
  phase: Phase;
  progress: number;
  documentId?: string;
  error?: string;
};

/**
 * Drag-and-drop upload.
 *
 * Bytes go straight from the browser to object storage via a presigned PUT —
 * they never pass through the Next.js server. That is what makes a 300 MB zip
 * a non-event.
 *
 * XMLHttpRequest rather than fetch: fetch still has no upload progress events,
 * and a large upload with no progress bar feels broken.
 */
export function UploadDropzone({
  collections,
}: {
  collections: Array<{ id: string; name: string }>;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    const next: Item[] = Array.from(files).map((file) => ({
      key: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
      file,
      title: stripExtension(file.name),
      tags: "",
      collectionName: "",
      visibility: "private" as const,
      phase: "queued" as const,
      progress: 0,
    }));
    setItems((prev) => [...prev, ...next]);
  }, []);

  function update(key: string, patch: Partial<Item>) {
    setItems((prev) =>
      prev.map((i) => (i.key === key ? { ...i, ...patch } : i)),
    );
  }

  async function uploadOne(item: Item) {
    update(item.key, { phase: "uploading", progress: 0, error: undefined });

    try {
      const presignRes = await fetch("/api/uploads/presign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: item.file.name,
          contentType: item.file.type || undefined,
          sizeBytes: item.file.size,
        }),
      });
      if (!presignRes.ok) {
        throw new Error(
          (await presignRes.json().catch(() => null))?.error ??
            "Could not start the upload",
        );
      }
      const { documentId, storageKey, uploadUrl, mimeType } =
        await presignRes.json();

      await putWithProgress(uploadUrl, item.file, mimeType, (pct) =>
        update(item.key, { progress: pct }),
      );

      update(item.key, { phase: "processing", progress: 100, documentId });

      const completeRes = await fetch("/api/uploads/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentId,
          storageKey,
          filename: item.file.name,
          mimeType,
          title: item.title.trim() || undefined,
          tags: item.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          visibility: item.visibility,
          collectionName: item.collectionName.trim() || undefined,
        }),
      });
      if (!completeRes.ok) {
        throw new Error(
          (await completeRes.json().catch(() => null))?.error ??
            "Could not save the document",
        );
      }
    } catch (err) {
      update(item.key, {
        phase: "error",
        error: err instanceof Error ? err.message : "Upload failed",
      });
    }
  }

  async function uploadAll() {
    // Sequential: three concurrent 200 MB uploads saturate the link and make
    // every progress bar crawl, which reads as a hang.
    for (const item of items) {
      if (item.phase === "queued" || item.phase === "error") {
        await uploadOne(item);
      }
    }
  }

  const processingIds = items
    .filter((i) => i.phase === "processing" && i.documentId)
    .map((i) => i.documentId!);

  // Poll while the worker extracts, so the status pill reflects reality.
  useEffect(() => {
    if (processingIds.length === 0) return;
    const timer = setInterval(async () => {
      const res = await fetch(
        `/api/documents/status?ids=${processingIds.join(",")}`,
      );
      if (!res.ok) return;
      const { documents } = await res.json();
      setItems((prev) =>
        prev.map((i) => {
          const found = documents?.find(
            (d: { id: string }) => d.id === i.documentId,
          );
          if (!found || i.phase !== "processing") return i;
          if (found.status === "ready") return { ...i, phase: "ready" };
          if (found.status === "failed") {
            return {
              ...i,
              phase: "error",
              error: found.failureReason ?? "Extraction failed",
            };
          }
          return i;
        }),
      );
    }, 1500);
    return () => clearInterval(timer);
  }, [processingIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = items.some(
    (i) => i.phase === "queued" || i.phase === "error",
  );
  const busy = items.some(
    (i) => i.phase === "uploading" || i.phase === "processing",
  );

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "rounded-xl border-2 border-dashed p-12 text-center transition-colors",
          dragging
            ? "border-accent bg-accent-subtle"
            : "border-border hover:border-border-strong",
        )}
      >
        <UploadCloud
          className="mx-auto size-8 text-fg-subtle"
          aria-hidden
        />
        <p className="mt-3 text-sm font-medium">
          Drop files here, or{" "}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded text-accent underline underline-offset-2"
          >
            browse
          </button>
        </p>
        <p className="mt-1 text-xs text-fg-subtle">
          Markdown, PDF, code, Word, Excel, PowerPoint, and zip archives
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {items.length > 0 && (
        <>
          <ul className="space-y-3">
            {items.map((item) => (
              <li
                key={item.key}
                className="rounded-xl border border-border bg-surface p-4"
              >
                <div className="flex items-start gap-3">
                  <KindIcon
                    kind={detectKind(item.file.name, item.file.type)}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-xs text-fg-muted">
                        {item.file.name}
                      </span>
                      <span className="shrink-0 text-xs text-fg-subtle">
                        {formatBytes(item.file.size)}
                      </span>
                      <PhaseBadge item={item} />
                      {item.phase === "queued" && (
                        <button
                          type="button"
                          aria-label={`Remove ${item.file.name}`}
                          onClick={() =>
                            setItems((prev) =>
                              prev.filter((i) => i.key !== item.key),
                            )
                          }
                          className="ml-auto rounded p-1 text-fg-subtle hover:text-fg"
                        >
                          <X className="size-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Editable while it uploads and processes — no modal. */}
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <Field
                        label="Title"
                        value={item.title}
                        onChange={(v) => update(item.key, { title: v })}
                        disabled={item.phase === "ready"}
                      />
                      <Field
                        label="Tags (comma separated)"
                        value={item.tags}
                        placeholder="docker, deploy"
                        onChange={(v) => update(item.key, { tags: v })}
                        disabled={item.phase === "ready"}
                      />
                      <Field
                        label="Collection"
                        value={item.collectionName}
                        placeholder="Old project name"
                        list="loredex-collections"
                        onChange={(v) =>
                          update(item.key, { collectionName: v })
                        }
                        disabled={item.phase === "ready"}
                      />
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                          Visibility
                        </span>
                        <select
                          value={item.visibility}
                          disabled={item.phase === "ready"}
                          onChange={(e) =>
                            update(item.key, {
                              visibility: e.target
                                .value as Item["visibility"],
                            })
                          }
                          className="w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm"
                        >
                          <option value="private">Private — only me</option>
                          <option value="unlisted">
                            Unlisted — anyone with the link
                          </option>
                          <option value="public">
                            Public — searchable by everyone
                          </option>
                        </select>
                      </label>
                    </div>

                    {item.phase === "uploading" && (
                      <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-hover">
                        <div
                          className="h-full bg-accent transition-[width]"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                    )}

                    {item.error && (
                      <p className="mt-2 flex items-start gap-1.5 text-xs text-danger">
                        <AlertCircle className="mt-px size-3.5 shrink-0" />
                        {item.error}
                      </p>
                    )}

                    {item.phase === "ready" && item.documentId && (
                      <Link
                        href={`/d/${item.documentId}`}
                        className="mt-2 inline-block text-xs text-accent underline underline-offset-2"
                      >
                        Open document
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <datalist id="loredex-collections">
            {collections.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={uploadAll}
              disabled={!pending || busy}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-40"
            >
              {busy ? "Uploading…" : "Upload all"}
            </button>
            <button
              type="button"
              onClick={() => setItems([])}
              disabled={busy}
              className="rounded-md px-3 py-2 text-sm text-fg-muted hover:text-fg disabled:opacity-40"
            >
              Clear
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PhaseBadge({ item }: { item: Item }) {
  if (item.phase === "queued") return null;

  const map = {
    uploading: {
      label: `${item.progress}%`,
      className: "bg-surface-hover text-fg-muted",
    },
    processing: {
      label: "Extracting",
      className: "bg-warn-subtle text-warn",
    },
    ready: { label: "Ready", className: "bg-ok-subtle text-ok" },
    error: { label: "Failed", className: "bg-danger-subtle text-danger" },
    queued: { label: "", className: "" },
  }[item.phase];

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        map.className,
      )}
    >
      {item.phase === "ready" && <Check className="size-3" />}
      {item.phase === "processing" && (
        <span className="size-1.5 animate-pulse rounded-full bg-current" />
      )}
      {map.label}
    </span>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  list,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  list?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
        {label}
      </span>
      <input
        type="text"
        value={value}
        list={list}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm placeholder:text-fg-subtle disabled:opacity-60"
      />
    </label>
  );
}

function putWithProgress(
  url: string,
  file: File,
  contentType: string,
  onProgress: (pct: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(
            new Error(
              // A CORS rejection surfaces here as status 0 with no body, which
              // is otherwise baffling to debug.
              xhr.status === 0
                ? "Upload blocked by the storage server (check its CORS configuration)"
                : `Storage rejected the upload (${xhr.status})`,
            ),
          );
    xhr.onerror = () =>
      reject(
        new Error(
          "Could not reach the storage server. Check its CORS configuration.",
        ),
      );
    xhr.send(file);
  });
}

function stripExtension(filename: string) {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}
