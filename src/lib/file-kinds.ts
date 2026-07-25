import type { DocumentKind } from "@/db/schema";

/**
 * Maps an uploaded file to the `kind` that drives both which extractor the
 * worker runs and which renderer the viewer picks.
 *
 * Extension-first, MIME as fallback: browsers report wildly inconsistent MIME
 * types for Markdown, YAML, and most source files (often `application/octet-
 * stream` or nothing at all), but the extension is reliable.
 */

const MARKDOWN = new Set(["md", "markdown", "mdx"]);

const CODE = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java",
  "kt", "swift", "c", "h", "cpp", "hpp", "cs", "php", "sh", "bash", "zsh",
  "fish", "sql", "html", "css", "scss", "less", "json", "yaml", "yml", "toml",
  "ini", "env", "xml", "graphql", "gql", "proto", "lua", "r", "jl", "vue",
  "svelte", "astro", "tf", "hcl", "dockerfile", "makefile", "gradle", "ipynb",
]);

const TEXT = new Set(["txt", "text", "log", "csv", "tsv", "rst", "adoc"]);

const OFFICE = new Set([
  "docx", "doc", "xlsx", "xls", "pptx", "ppt", "odt", "ods", "odp", "rtf",
]);

const ARCHIVE = new Set(["zip"]);

/** Filenames with no extension that are nonetheless plainly code. */
const CODE_BY_NAME = new Set([
  "dockerfile", "makefile", "rakefile", "gemfile", "procfile", "justfile",
  "caddyfile", "vagrantfile", "brewfile",
]);

export function extensionOf(filename: string): string {
  const base = filename.split("/").pop() ?? filename;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function detectKind(filename: string, mimeType?: string): DocumentKind {
  const base = (filename.split("/").pop() ?? filename).toLowerCase();
  const ext = extensionOf(filename);

  if (CODE_BY_NAME.has(base) || CODE_BY_NAME.has(base.split(".")[0])) {
    return "code";
  }
  if (MARKDOWN.has(ext)) return "markdown";
  if (ext === "pdf") return "pdf";
  if (CODE.has(ext)) return "code";
  if (TEXT.has(ext)) return "text";
  if (OFFICE.has(ext)) return "office";
  if (ARCHIVE.has(ext)) return "archive";

  const mime = mimeType?.toLowerCase() ?? "";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("text/")) return "text";
  if (mime.includes("zip")) return "archive";
  if (
    mime.includes("officedocument") ||
    mime.includes("msword") ||
    mime.includes("ms-excel") ||
    mime.includes("ms-powerpoint") ||
    mime.includes("opendocument")
  ) {
    return "office";
  }

  return "other";
}

/** Content-Type to send when the browser gave us nothing useful. */
export function guessMimeType(filename: string, provided?: string) {
  if (provided && provided !== "application/octet-stream") return provided;
  const ext = extensionOf(filename);
  const table: Record<string, string> = {
    md: "text/markdown",
    markdown: "text/markdown",
    pdf: "application/pdf",
    txt: "text/plain",
    csv: "text/csv",
    json: "application/json",
    zip: "application/zip",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    doc: "application/msword",
    xls: "application/vnd.ms-excel",
    ppt: "application/vnd.ms-powerpoint",
  };
  return table[ext] ?? provided ?? "application/octet-stream";
}

/** The language hint handed to the syntax highlighter. */
export function languageOf(filename: string): string {
  const base = (filename.split("/").pop() ?? filename).toLowerCase();
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "docker";
  if (base === "makefile") return "makefile";
  if (base === "caddyfile") return "caddyfile";

  const ext = extensionOf(filename);
  const table: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
    mjs: "javascript", cjs: "javascript", py: "python", rb: "ruby",
    rs: "rust", go: "go", java: "java", kt: "kotlin", swift: "swift",
    c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp", php: "php",
    sh: "bash", bash: "bash", zsh: "bash", fish: "fish", sql: "sql",
    html: "html", css: "css", scss: "scss", less: "less", json: "json",
    yaml: "yaml", yml: "yaml", toml: "toml", ini: "ini", xml: "xml",
    graphql: "graphql", gql: "graphql", proto: "protobuf", lua: "lua",
    r: "r", jl: "julia", vue: "vue", svelte: "svelte", astro: "astro",
    tf: "hcl", hcl: "hcl", md: "markdown", markdown: "markdown",
  };
  return table[ext] ?? "text";
}

const TEXTUAL_KINDS = new Set<DocumentKind>(["markdown", "code", "text"]);
export function isTextual(kind: DocumentKind) {
  return TEXTUAL_KINDS.has(kind);
}
