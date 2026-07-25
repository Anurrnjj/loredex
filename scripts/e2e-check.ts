import "./load-env";

import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { inArray } from "drizzle-orm";
import * as XLSX from "xlsx";

import { db, sql } from "../src/db";
import { documents, documentContent, jobs, users } from "../src/db/schema";
import { detectKind, guessMimeType } from "../src/lib/file-kinds";
import { searchDocuments } from "../src/lib/queries";
import { setDocumentTags } from "../src/lib/tags";
import { buildStorageKey, presignUpload, deleteObject } from "../src/lib/s3";

const execFileAsync = promisify(execFile);

/**
 * End-to-end check against the real local Postgres and MinIO.
 *
 * Walks the whole path a user takes: presigned upload -> document row -> job ->
 * worker extraction -> search -> visibility rules. Creates two throwaway users
 * and removes everything it made on the way out.
 *
 * Run the worker in another terminal first: `pnpm worker`
 */

const USER_A = `test_user_a_${randomUUID().slice(0, 8)}`;
const USER_B = `test_user_b_${randomUUID().slice(0, 8)}`;

let failures = 0;
const createdDocIds: string[] = [];
const createdKeys: string[] = [];

function assert(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failures++;
    console.log(`FAIL  ${label}${detail ? `\n      ${detail}` : ""}`);
  }
}

async function uploadDocument(opts: {
  ownerId: string;
  filename: string;
  body: Buffer;
  title: string;
  tags?: string[];
  visibility?: "private" | "unlisted" | "public";
}) {
  const documentId = randomUUID();
  const mimeType = guessMimeType(opts.filename);
  const storageKey = buildStorageKey(opts.ownerId, documentId, opts.filename);

  // Exercise the real presigned-PUT path the browser uses.
  const url = await presignUpload(storageKey, mimeType);
  const res = await fetch(url, {
    method: "PUT",
    body: new Uint8Array(opts.body),
    headers: { "content-type": mimeType },
  });
  if (!res.ok) throw new Error(`presigned PUT failed: ${res.status}`);

  const title = opts.title;
  await db.transaction(async (tx) => {
    await tx.insert(documents).values({
      id: documentId,
      ownerId: opts.ownerId,
      title,
      originalFilename: opts.filename,
      mimeType,
      kind: detectKind(opts.filename, mimeType),
      sizeBytes: opts.body.length,
      storageKey,
      visibility: opts.visibility ?? "private",
      status: "pending",
    });
    await tx
      .insert(documentContent)
      .values({ documentId, title })
      .onConflictDoUpdate({
        target: documentContent.documentId,
        set: { title },
      });
    await tx.insert(jobs).values({ documentId, type: "extract" });
  });

  if (opts.tags?.length) await setDocumentTags(documentId, opts.tags);

  createdDocIds.push(documentId);
  createdKeys.push(storageKey);
  return documentId;
}

async function waitForReady(ids: string[], timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const rows = await db
      .select({
        id: documents.id,
        status: documents.status,
        failureReason: documents.failureReason,
      })
      .from(documents)
      .where(inArray(documents.id, ids));

    if (rows.every((r) => r.status === "ready" || r.status === "failed")) {
      return rows;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(
    "Timed out waiting for extraction. Is the worker running? (`pnpm worker`)",
  );
}

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "loredex-e2e-"));

  await db
    .insert(users)
    .values([
      { id: USER_A, email: "a@example.test", displayName: "User A" },
      { id: USER_B, email: "b@example.test", displayName: "User B" },
    ])
    .onConflictDoNothing();

  // --- build fixtures -----------------------------------------------------
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["service", "port"],
      ["postgres", 5432],
    ]),
    "Ports",
  );

  const zipDir = join(dir, "oldproject");
  await execFileAsync("mkdir", ["-p", zipDir]);
  await writeFile(
    join(zipDir, "Dockerfile"),
    "FROM node:20-slim\nRUN apt-get update && apt-get install -y curl\n",
  );
  await execFileAsync("zip", ["-rq", join(dir, "oldproject.zip"), "oldproject"], {
    cwd: dir,
  });

  const htmlPath = join(dir, "guide.html");
  await writeFile(
    htmlPath,
    "<h1>Prompt guide</h1><p>Always specify the output format explicitly.</p>",
  );
  await execFileAsync(
    "soffice",
    ["--headless", "--convert-to", "pdf", "--outdir", dir, htmlPath],
    { timeout: 180_000 },
  );

  // --- upload -------------------------------------------------------------
  console.log("\nUploading fixtures…");
  const mdId = await uploadDocument({
    ownerId: USER_A,
    filename: "docker-setup.md",
    body: Buffer.from(
      "# Docker setup\n\nUse a multi stage build. Compose brings up postgres and minio.\n",
    ),
    title: "Docker setup",
    tags: ["docker", "deploy"],
  });
  const zipId = await uploadDocument({
    ownerId: USER_A,
    filename: "oldproject.zip",
    body: await readFile(join(dir, "oldproject.zip")),
    title: "Old project archive",
  });
  const xlsxId = await uploadDocument({
    ownerId: USER_A,
    filename: "ports.xlsx",
    body: Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" })),
    title: "Service ports",
  });
  const pdfId = await uploadDocument({
    ownerId: USER_A,
    filename: "guide.pdf",
    body: await readFile(join(dir, "guide.pdf")),
    title: "Prompt guide",
  });
  const publicId = await uploadDocument({
    ownerId: USER_A,
    filename: "public-notes.md",
    body: Buffer.from("# Kubernetes notes\n\nkubectl apply is idempotent.\n"),
    title: "Kubernetes notes",
    visibility: "public",
  });

  console.log("Waiting for the worker to extract…");
  const finished = await waitForReady([mdId, zipId, xlsxId, pdfId, publicId]);

  for (const row of finished) {
    assert(
      `extracted ${row.id.slice(0, 8)}`,
      row.status === "ready",
      row.failureReason ?? "",
    );
  }

  // --- search -------------------------------------------------------------
  console.log("\nSearching…");

  const dockerHits = await searchDocuments({ q: "docker", viewerId: USER_A });
  const dockerIds = dockerHits.map((h) => h.id);
  assert(
    "'docker' finds the markdown doc",
    dockerIds.includes(mdId),
    `got ${dockerIds.length} hits`,
  );
  if (!dockerIds.includes(zipId)) {
    const [stored] = await sql<Array<{ txt: string; tsv: string }>>`
      SELECT extracted_text AS txt, search_vector::text AS tsv
      FROM document_content WHERE document_id = ${zipId}
    `;
    console.log("      stored text:", JSON.stringify(stored?.txt ?? null));
    console.log("      stored tsv :", (stored?.tsv ?? "").slice(0, 400));
  }
  assert(
    "'docker' finds the zip via its inner Dockerfile",
    dockerIds.includes(zipId),
    "the archive's contents were not indexed",
  );

  const snippet = dockerHits.find((h) => h.id === mdId)?.snippet ?? "";
  assert(
    "snippet highlights the match",
    snippet.includes("<mark>"),
    `snippet was: ${snippet.slice(0, 120)}`,
  );

  const phrase = await searchDocuments({ q: '"multi stage"', viewerId: USER_A });
  assert(
    "quoted phrase search works",
    phrase.some((h) => h.id === mdId),
  );

  const excluded = await searchDocuments({
    q: "docker -compose",
    viewerId: USER_A,
  });
  assert(
    "negation excludes the compose doc",
    !excluded.some((h) => h.id === mdId),
    "doc mentioning 'Compose' should have been excluded",
  );

  const typo = await searchDocuments({ q: "dcoker setup", viewerId: USER_A });
  assert(
    "trigram fallback survives a typo",
    typo.some((h) => h.id === mdId),
    `got: ${typo.map((h) => h.title).join(", ")}`,
  );

  const xlsxHits = await searchDocuments({ q: "postgres", viewerId: USER_A });
  assert(
    "spreadsheet contents are searchable",
    xlsxHits.some((h) => h.id === xlsxId),
  );

  const pdfHits = await searchDocuments({
    q: "output format",
    viewerId: USER_A,
  });
  assert("pdf text is searchable", pdfHits.some((h) => h.id === pdfId));

  const tagHits = await searchDocuments({
    q: "docker",
    viewerId: USER_A,
    tag: "deploy",
  });
  assert("tag filter narrows results", tagHits.every((h) => h.id === mdId));

  const kindHits = await searchDocuments({
    q: "docker",
    viewerId: USER_A,
    kind: "archive",
  });
  assert(
    "kind filter narrows results",
    kindHits.length > 0 && kindHits.every((h) => h.kind === "archive"),
  );

  // --- access control -----------------------------------------------------
  console.log("\nChecking access control…");

  const asB = await searchDocuments({ q: "docker", viewerId: USER_B });
  assert(
    "another user cannot find private docs",
    !asB.some((h) => h.id === mdId || h.id === zipId),
    `leaked: ${asB.map((h) => h.title).join(", ")}`,
  );

  const publicToB = await searchDocuments({
    q: "kubernetes",
    viewerId: USER_B,
  });
  assert(
    "another user can find public docs",
    publicToB.some((h) => h.id === publicId),
  );

  const anon = await searchDocuments({ q: "kubernetes", viewerId: null });
  assert("signed-out search sees public docs", anon.some((h) => h.id === publicId));

  const anonPrivate = await searchDocuments({ q: "docker", viewerId: null });
  assert(
    "signed-out search sees no private docs",
    anonPrivate.length === 0,
    `leaked ${anonPrivate.length}`,
  );

  const mineOnly = await searchDocuments({
    q: "kubernetes",
    viewerId: USER_B,
    scope: "mine",
  });
  assert("scope=mine excludes others' public docs", mineOnly.length === 0);

  // --- index usage --------------------------------------------------------
  // On a table this small Postgres correctly prefers a sequential scan, so a
  // plain EXPLAIN proves nothing. Disabling seq scans forces the question we
  // actually care about: is the GIN index valid and applicable to this
  // predicate? If it were misdefined, the planner could not use it even here.
  await sql`SET enable_seqscan = off`;
  const plan = await sql`
    EXPLAIN (FORMAT JSON)
    SELECT dc.document_id FROM document_content dc
    WHERE dc.search_vector @@ websearch_to_tsquery('english', 'docker')
  `;
  await sql`SET enable_seqscan = on`;

  const planText = JSON.stringify(plan);
  assert(
    "GIN index is applicable to the search predicate",
    planText.includes("document_content_search_idx"),
    planText.slice(0, 300),
  );

  // --- cleanup ------------------------------------------------------------
  await db.delete(documents).where(inArray(documents.id, createdDocIds));
  await db.delete(users).where(inArray(users.id, [USER_A, USER_B]));
  for (const key of createdKeys) {
    await deleteObject(key).catch(() => {});
  }
  await rm(dir, { recursive: true, force: true });
  await sql.end({ timeout: 5 });

  console.log(
    failures === 0
      ? "\nAll end-to-end checks passed."
      : `\n${failures} end-to-end check(s) failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("\ne2e failed:", err);
  // Best-effort cleanup so a failed run does not poison the next one.
  if (createdDocIds.length) {
    await db
      .delete(documents)
      .where(inArray(documents.id, createdDocIds))
      .catch(() => {});
  }
  await db
    .delete(users)
    .where(inArray(users.id, [USER_A, USER_B]))
    .catch(() => {});
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
