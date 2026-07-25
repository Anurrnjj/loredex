"use client";

import { useMemo, useState } from "react";
import { ChevronRight, File, Folder, FolderOpen } from "lucide-react";

import { cn, formatBytes } from "@/lib/utils";

type Entry = {
  path: string;
  sizeBytes: number;
  isDirectory: boolean;
  isText: boolean;
  textPreview: string | null;
};

type TreeNode = {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  entry?: Entry;
};

/**
 * Browses an archive without downloading it.
 *
 * The entries were indexed at upload time, and small text files had their
 * contents stored, so opening a file inside a zip is a database read rather
 * than a re-download and re-extract of the whole archive.
 */
export function ZipView({ entries }: { entries: Entry[] }) {
  const [selected, setSelected] = useState<Entry | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));

  const tree = useMemo(() => buildTree(entries), [entries]);

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-surface p-2">
        <TreeLevel
          node={tree}
          depth={0}
          expanded={expanded}
          toggle={toggle}
          selected={selected}
          onSelect={setSelected}
        />
      </div>

      <div className="min-w-0">
        {selected ? (
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs">
              <span className="truncate font-mono text-fg-muted">
                {selected.path}
              </span>
              <span className="shrink-0 text-fg-subtle">
                {formatBytes(selected.sizeBytes)}
              </span>
            </div>
            {selected.textPreview ? (
              <pre className="max-h-[60vh] overflow-auto p-4 font-mono text-xs leading-relaxed">
                {selected.textPreview}
              </pre>
            ) : (
              <p className="p-10 text-center text-sm text-fg-muted">
                {selected.isText
                  ? "This file is too large to preview inline."
                  : "This is a binary file. Download the archive to open it."}
              </p>
            )}
          </div>
        ) : (
          <div className="flex h-full min-h-40 items-center justify-center rounded-lg border border-dashed border-border p-10">
            <p className="text-sm text-fg-subtle">
              Select a file to preview its contents.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function TreeLevel({
  node,
  depth,
  expanded,
  toggle,
  selected,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  toggle: (path: string) => void;
  selected: Entry | null;
  onSelect: (e: Entry) => void;
}) {
  const children = [...node.children.values()].sort((a, b) => {
    const aDir = a.children.size > 0;
    const bDir = b.children.size > 0;
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <ul className={cn(depth > 0 && "ml-3 border-l border-border pl-2")}>
      {children.map((child) => {
        const isDir = child.children.size > 0;
        const isOpen = expanded.has(child.path);
        const isSelected = selected?.path === child.entry?.path;

        return (
          <li key={child.path}>
            <button
              type="button"
              onClick={() =>
                isDir
                  ? toggle(child.path)
                  : child.entry && onSelect(child.entry)
              }
              className={cn(
                "flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs transition-colors",
                isSelected
                  ? "bg-accent-subtle text-accent"
                  : "hover:bg-surface-hover",
              )}
            >
              {isDir ? (
                <>
                  <ChevronRight
                    className={cn(
                      "size-3 shrink-0 text-fg-subtle transition-transform",
                      isOpen && "rotate-90",
                    )}
                    aria-hidden
                  />
                  {isOpen ? (
                    <FolderOpen className="size-3.5 shrink-0 text-fg-subtle" />
                  ) : (
                    <Folder className="size-3.5 shrink-0 text-fg-subtle" />
                  )}
                </>
              ) : (
                <>
                  <span className="w-3 shrink-0" />
                  <File className="size-3.5 shrink-0 text-fg-subtle" />
                </>
              )}
              <span className="truncate font-mono">{child.name}</span>
            </button>

            {isDir && isOpen && (
              <TreeLevel
                node={child}
                depth={depth + 1}
                expanded={expanded}
                toggle={toggle}
                selected={selected}
                onSelect={onSelect}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function buildTree(entries: Entry[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map() };

  for (const entry of entries) {
    const segments = entry.path.split("/").filter(Boolean);
    let node = root;

    segments.forEach((segment, i) => {
      const path = segments.slice(0, i + 1).join("/");
      let child = node.children.get(segment);
      if (!child) {
        child = { name: segment, path, children: new Map() };
        node.children.set(segment, child);
      }
      if (i === segments.length - 1 && !entry.isDirectory) {
        child.entry = entry;
      }
      node = child;
    });
  }

  return root;
}
