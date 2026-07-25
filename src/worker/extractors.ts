import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import mammoth from "mammoth";
import sanitizeHtml from "sanitize-html";
import * as XLSX from "xlsx";
import yauzl from "yauzl";

import type { DocumentKind } from "@/db/schema";
import { extensionOf } from "@/lib/file-kinds";

const execFileAsync = promisify(execFile);

/**
 * Caps how much text we index per document. Beyond this the tsvector stops
 * paying for itself — Postgres has a 1 MB hard limit per tsvector, and a
 * multi-megabyte one ranks poorly anyway because term frequency flattens.
 */
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

/**
 * Whitelist for converted Office HTML.
 *
 * mammoth and SheetJS produce structural markup from a file we did not write,
 * so the output is untrusted. sanitize-html parses with htmlparser2 rather
 * than emulating a DOM, which keeps the worker bundle small — DOMPurify would
 * pull in the whole of jsdom for the same job.
 */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "div", "span",
    "section", "blockquote", "pre", "code", "em", "strong", "i", "b", "u",
    "sub", "sup", "ul", "ol", "li", "table", "thead", "tbody", "tfoot",
    "tr", "th", "td", "caption", "a", "img",
  ],
  allowedAttributes: {
    a: ["href", "title"],
    img: ["src", "alt", "title", "width", "height"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan", "scope"],
    "*": ["id"],
  },
  // Images inside .docx arrive as base64 data URIs from mammoth; http(s) is
  // allowed so an externally-referenced image still resolves.
  allowedSchemes: ["http", "https", "mailto", "data"],
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  // Anything not on the list is dropped tag-and-contents, not unwrapped —
  // otherwise the body of a <script> would survive as visible text.
  nonTextTags: ["style", "script", "textarea", "option", "noscript"],
};

/** Entries larger than this inside a zip are listed but not indexed. */
const MAX_ZIP_ENTRY_BYTES = 512 * 1024;
const MAX_ZIP_ENTRIES = 2000;

export type ExtractResult = {
  text: string;
  pageCount?: number;
  /** A rendered preview to cache in storage, when conversion was needed. */
  preview?: { body: Buffer | string; mime: string; ext: string };
  zipEntries?: Array<{
    path: string;
    sizeBytes: number;
    isDirectory: boolean;
    isText: boolean;
    textPreview: string | null;
  }>;
};

/** Routes to the right extractor. Unknown kinds index their filename only. */
export async function extract(
  buffer: Buffer,
  filename: string,
  kind: DocumentKind,
): Promise<ExtractResult> {
  switch (kind) {
    case "markdown":
    case "code":
    case "text":
      return { text: clampText(decodeText(buffer)) };
    case "pdf":
      return extractPdf(buffer);
    case "office":
      return extractOffice(buffer, filename);
    case "archive":
      return extractZip(buffer);
    default:
      return { text: "" };
  }
}

// --- text -------------------------------------------------------------------

/**
 * Postgres rejects NUL bytes in text columns, and extracted content from PDFs
 * and Office files regularly contains them. Strip rather than fail: a stray
 * control character should never cost the user a searchable document.
 */
export function sanitizeText(input: string) {
  return input
    // NUL bytes: Postgres rejects these outright in text columns, and PDF and
    // Office extraction produces them routinely.
    .replace(/\u0000/g, "")
    // Remaining C0 controls and DEL, keeping \t \n \r.
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function decodeText(buffer: Buffer) {
  return sanitizeText(buffer.toString("utf8"));
}

function clampText(text: string) {
  if (Buffer.byteLength(text, "utf8") <= MAX_TEXT_BYTES) return text;
  return `${Buffer.from(text, "utf8").subarray(0, MAX_TEXT_BYTES).toString("utf8")}\n\n[truncated]`;
}

// --- pdf --------------------------------------------------------------------

async function extractPdf(buffer: Buffer): Promise<ExtractResult> {
  // The legacy build is the one that runs under Node without a DOM.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // Node has no canvas or font stack; we only ever read the text layer.
    useSystemFonts: false,
    // 0 = errors only. pdf.js is otherwise very chatty about malformed PDFs,
    // which most real-world PDFs technically are.
    verbosity: 0,
  });
  const doc = await loadingTask.promise;

  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    parts.push(pageText);
    page.cleanup();

    if (Buffer.byteLength(parts.join("\n"), "utf8") > MAX_TEXT_BYTES) break;
  }

  const pageCount = doc.numPages;
  // In pdf.js v6 teardown lives on the loading task, not the document.
  await loadingTask.destroy();

  return {
    text: clampText(sanitizeText(parts.join("\n\n"))),
    pageCount,
  };
}

// --- office -----------------------------------------------------------------

const LIBREOFFICE_FORMATS = new Set([
  "pptx", "ppt", "doc", "xls", "odt", "ods", "odp", "rtf",
]);

/**
 * Word and Excel are handled in pure JS — fast, no subprocess, and they cover
 * the overwhelming majority of uploads. PowerPoint and the legacy binary
 * formats fall back to LibreOffice, which is slow and memory-hungry but the
 * only realistic option.
 */
async function extractOffice(
  buffer: Buffer,
  filename: string,
): Promise<ExtractResult> {
  const ext = extensionOf(filename);

  if (ext === "docx") {
    const [{ value: html }, { value: text }] = await Promise.all([
      mammoth.convertToHtml({ buffer }),
      mammoth.extractRawText({ buffer }),
    ]);
    return {
      text: clampText(sanitizeText(text)),
      preview: {
        // The HTML comes from a user-supplied file, so it is untrusted.
        body: sanitizeHtml(html, SANITIZE_OPTIONS),
        mime: "text/html",
        ext: "html",
      },
    };
  }

  if (ext === "xlsx" || ext === "xls" || ext === "csv") {
    const wb = XLSX.read(buffer, { type: "buffer" });
    const textParts: string[] = [];
    const htmlParts: string[] = [];

    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      textParts.push(`# ${name}\n${XLSX.utils.sheet_to_csv(sheet)}`);
      htmlParts.push(
        `<section><h2>${escapeHtml(name)}</h2>${XLSX.utils.sheet_to_html(sheet)}</section>`,
      );
    }

    return {
      text: clampText(sanitizeText(textParts.join("\n\n"))),
      preview: {
        body: sanitizeHtml(htmlParts.join("\n"), SANITIZE_OPTIONS),
        mime: "text/html",
        ext: "html",
      },
    };
  }

  if (LIBREOFFICE_FORMATS.has(ext)) {
    const pdf = await convertWithLibreOffice(buffer, filename);
    const { text, pageCount } = await extractPdf(pdf);
    return {
      text,
      pageCount,
      preview: { body: pdf, mime: "application/pdf", ext: "pdf" },
    };
  }

  return { text: "" };
}

/**
 * Converts to PDF via headless LibreOffice, then reuses the PDF path for both
 * text and preview. Requires `soffice` on PATH — it is installed in the
 * production image and is the reason the app is containerised rather than
 * deployed to a serverless platform.
 */
async function convertWithLibreOffice(
  buffer: Buffer,
  filename: string,
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "loredex-"));
  try {
    const safeName = (filename.split("/").pop() ?? "input").replace(
      /[^\w.\-]+/g,
      "_",
    );
    const input = join(dir, safeName);
    await writeFile(input, buffer);

    await execFileAsync(
      "soffice",
      [
        "--headless",
        "--norestore",
        "--invisible",
        "--convert-to",
        "pdf",
        "--outdir",
        dir,
        input,
      ],
      { timeout: 180_000, maxBuffer: 32 * 1024 * 1024 },
    );

    const produced = (await readdir(dir)).find((f) => f.endsWith(".pdf"));
    if (!produced) {
      throw new Error("LibreOffice produced no PDF output");
    }
    return await readFile(join(dir, produced));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// --- zip --------------------------------------------------------------------

const TEXT_ENTRY_EXTENSIONS = new Set([
  "md", "markdown", "txt", "json", "yaml", "yml", "toml", "ini", "env",
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java",
  "kt", "swift", "c", "h", "cpp", "hpp", "cs", "php", "sh", "bash", "sql",
  "html", "css", "scss", "xml", "csv", "log", "tf", "hcl", "gradle", "properties",
]);

const TEXT_ENTRY_NAMES = new Set([
  "dockerfile", "makefile", "readme", "license", "caddyfile", "procfile",
  ".gitignore", ".dockerignore", ".env",
]);

/**
 * Indexes the *contents* of an archive, not just its name.
 *
 * This is what makes a zipped project boilerplate findable by searching
 * "docker" — the Dockerfile inside it gets indexed into the parent document's
 * search vector.
 */
async function extractZip(buffer: Buffer): Promise<ExtractResult> {
  const entries: NonNullable<ExtractResult["zipEntries"]> = [];
  const textChunks: string[] = [];

  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error("Unreadable zip"));

      zipfile.on("error", reject);
      zipfile.on("end", resolve);
      zipfile.readEntry();

      zipfile.on("entry", (entry) => {
        const path = entry.fileName;
        const isDirectory = path.endsWith("/");

        // Reject path traversal outright. We never write these to disk, but
        // they also drive the viewer's tree and its per-entry fetch route.
        if (path.includes("..") || path.startsWith("/")) {
          zipfile.readEntry();
          return;
        }

        if (entries.length >= MAX_ZIP_ENTRIES) {
          zipfile.readEntry();
          return;
        }

        const size = entry.uncompressedSize;
        const textual = !isDirectory && isTextEntry(path);
        const shouldRead = textual && size > 0 && size <= MAX_ZIP_ENTRY_BYTES;

        if (!shouldRead) {
          entries.push({
            path,
            sizeBytes: size,
            isDirectory,
            isText: textual,
            textPreview: null,
          });
          zipfile.readEntry();
          return;
        }

        zipfile.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            entries.push({
              path,
              sizeBytes: size,
              isDirectory,
              isText: textual,
              textPreview: null,
            });
            zipfile.readEntry();
            return;
          }

          const chunks: Buffer[] = [];
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("error", () => zipfile.readEntry());
          stream.on("end", () => {
            const content = sanitizeText(Buffer.concat(chunks).toString("utf8"));
            entries.push({
              path,
              sizeBytes: size,
              isDirectory,
              isText: true,
              textPreview: content.slice(0, 20_000),
            });
            // Segments as well as the whole path — see the note on pathIndex.
            textChunks.push(
              `${path} ${path.split("/").filter(Boolean).join(" ")}\n${content}`,
            );
            zipfile.readEntry();
          });
        });
      });
    });
  });

  // Every path is indexed regardless, so searching a filename always works.
  //
  // Paths are indexed twice: whole, and split into segments. Postgres's parser
  // classifies "oldproject/Dockerfile" as a single *file path* token, so the
  // lexeme is `oldproject/dockerfile` and a search for "docker" can never
  // reach it. Emitting the bare segments as well gives the stemmer a plain
  // `dockerfil` token that prefix matching does find.
  const pathIndex = entries
    .map((e) => `${e.path} ${e.path.split("/").filter(Boolean).join(" ")}`)
    .join("\n");

  return {
    text: clampText(sanitizeText(`${pathIndex}\n\n${textChunks.join("\n\n")}`)),
    zipEntries: entries,
  };
}

function isTextEntry(path: string) {
  const base = (path.split("/").pop() ?? path).toLowerCase();
  if (TEXT_ENTRY_NAMES.has(base)) return true;
  if (base.startsWith("dockerfile")) return true;
  return TEXT_ENTRY_EXTENSIONS.has(extensionOf(base));
}

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
