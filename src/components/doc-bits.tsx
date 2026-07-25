import {
  Archive,
  FileCode,
  FileText,
  FileType,
  FileSpreadsheet,
  File as FileIcon,
  Globe,
  Link2,
  Lock,
} from "lucide-react";

import type { DocumentKind, Visibility } from "@/db/schema";
import { cn } from "@/lib/utils";

const KIND_ICONS: Record<DocumentKind, typeof FileIcon> = {
  markdown: FileText,
  pdf: FileType,
  code: FileCode,
  text: FileText,
  office: FileSpreadsheet,
  archive: Archive,
  other: FileIcon,
};

const KIND_LABELS: Record<DocumentKind, string> = {
  markdown: "Markdown",
  pdf: "PDF",
  code: "Code",
  text: "Text",
  office: "Document",
  archive: "Archive",
  other: "File",
};

export function KindIcon({
  kind,
  className,
}: {
  kind: DocumentKind;
  className?: string;
}) {
  const Icon = KIND_ICONS[kind] ?? FileIcon;
  return (
    <Icon
      className={cn("size-4 text-fg-subtle", className)}
      aria-label={KIND_LABELS[kind]}
    />
  );
}

export function kindLabel(kind: DocumentKind) {
  return KIND_LABELS[kind] ?? "File";
}

/**
 * Status is the one place semantic colour is allowed. A failed extraction must
 * be loud — a document that silently never became searchable is worse than one
 * that visibly failed.
 */
export function StatusPill({
  status,
}: {
  status: "pending" | "processing" | "ready" | "failed";
}) {
  if (status === "ready") return null;

  const styles = {
    pending: "bg-surface-hover text-fg-muted",
    processing: "bg-warn-subtle text-warn",
    failed: "bg-danger-subtle text-danger",
    ready: "",
  }[status];

  const label = {
    pending: "Queued",
    processing: "Processing",
    failed: "Failed",
    ready: "",
  }[status];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        styles,
      )}
    >
      {status === "processing" && (
        <span className="mr-1.5 size-1.5 animate-pulse rounded-full bg-current" />
      )}
      {label}
    </span>
  );
}

export function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  const map = {
    private: { Icon: Lock, label: "Private" },
    unlisted: { Icon: Link2, label: "Unlisted" },
    public: { Icon: Globe, label: "Public" },
  } as const;
  const { Icon, label } = map[visibility];

  return (
    <span className="inline-flex items-center gap-1 text-xs text-fg-subtle">
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  );
}

export function TagChip({
  name,
  href,
  active,
}: {
  name: string;
  href?: string;
  active?: boolean;
}) {
  const className = cn(
    "inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs transition-colors",
    active
      ? "border-accent bg-accent-subtle text-accent"
      : "text-fg-muted hover:border-border-strong hover:text-fg",
  );

  if (!href) return <span className={className}>{name}</span>;
  return (
    <a href={href} className={className}>
      {name}
    </a>
  );
}
