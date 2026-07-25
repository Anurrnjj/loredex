import "../../scripts/load-env";

import { eq } from "drizzle-orm";

import { db, sql } from "@/db";
import { documentContent, documents, zipEntries } from "@/db/schema";
import { buildPreviewKey, getObjectBuffer, putObject } from "@/lib/s3";
import { extract } from "./extractors";

/**
 * The extraction worker.
 *
 * Runs as its own process (the same image as the web server, different
 * command). Extraction takes seconds to minutes for large PDFs and shells out
 * to LibreOffice for PowerPoint — doing that inside a web request means
 * timeouts and a UI that hangs on upload. Instead the upload returns instantly
 * with status `pending` and the document page updates as this worker progresses.
 */

const POLL_INTERVAL_MS = 2_000;
const BACKOFF_BASE_MS = 15_000;

let shuttingDown = false;

type ClaimedJob = {
  id: string;
  document_id: string;
  type: string;
  attempts: number;
  max_attempts: number;
};

/**
 * Claims one job atomically.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes this safe to run in multiple
 * replicas: concurrent workers step over each other's locked rows instead of
 * blocking or double-processing.
 */
async function claimJob(): Promise<ClaimedJob | null> {
  const rows = await sql<ClaimedJob[]>`
    UPDATE jobs
    SET status = 'running', attempts = attempts + 1
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'queued' AND run_after <= now()
      ORDER BY run_after ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, document_id, type, attempts, max_attempts
  `;
  return rows[0] ?? null;
}

async function runExtractJob(job: ClaimedJob) {
  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, job.document_id))
    .limit(1);

  if (!doc) {
    // The document was deleted while the job sat in the queue. Not an error.
    await sql`UPDATE jobs SET status = 'done' WHERE id = ${job.id}`;
    return;
  }

  await db
    .update(documents)
    .set({ status: "processing", updatedAt: new Date() })
    .where(eq(documents.id, doc.id));

  const buffer = await getObjectBuffer(doc.storageKey);
  const result = await extract(buffer, doc.originalFilename, doc.kind);

  let previewKey: string | null = null;
  let previewMime: string | null = null;
  if (result.preview) {
    previewKey = buildPreviewKey(doc.id, result.preview.ext);
    previewMime = result.preview.mime;
    await putObject(previewKey, result.preview.body, result.preview.mime);
  }

  await db.transaction(async (tx) => {
    // Note the title is written here too: it feeds the generated search_vector,
    // which can only reference columns in its own row.
    await tx
      .insert(documentContent)
      .values({
        documentId: doc.id,
        title: doc.title,
        extractedText: result.text,
        pageCount: result.pageCount ?? null,
        previewKey,
        previewMime,
      })
      .onConflictDoUpdate({
        target: documentContent.documentId,
        set: {
          title: doc.title,
          extractedText: result.text,
          pageCount: result.pageCount ?? null,
          previewKey,
          previewMime,
          updatedAt: new Date(),
        },
      });

    if (result.zipEntries) {
      await tx.delete(zipEntries).where(eq(zipEntries.documentId, doc.id));
      // Chunked: a zip with 2000 entries exceeds the bind-parameter limit in
      // a single insert.
      for (let i = 0; i < result.zipEntries.length; i += 500) {
        await tx.insert(zipEntries).values(
          result.zipEntries.slice(i, i + 500).map((e) => ({
            documentId: doc.id,
            path: e.path,
            sizeBytes: e.sizeBytes,
            isDirectory: e.isDirectory,
            isText: e.isText,
            textPreview: e.textPreview,
          })),
        );
      }
    }

    await tx
      .update(documents)
      .set({ status: "ready", failureReason: null, updatedAt: new Date() })
      .where(eq(documents.id, doc.id));
  });

  await sql`UPDATE jobs SET status = 'done', last_error = NULL WHERE id = ${job.id}`;
  console.log(`[worker] extracted ${doc.id} (${doc.kind}) "${doc.title}"`);
}

async function failJob(job: ClaimedJob, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const exhausted = job.attempts >= job.max_attempts;

  if (exhausted) {
    await sql`UPDATE jobs SET status = 'failed', last_error = ${message} WHERE id = ${job.id}`;
    await db
      .update(documents)
      .set({
        status: "failed",
        // Surfaced verbatim in the UI with a Retry button. A silent failure in
        // an archive you trust is worse than a loud one.
        failureReason: message.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(documents.id, job.document_id));
    console.error(`[worker] job ${job.id} failed permanently: ${message}`);
    return;
  }

  // Exponential backoff, so a transient storage blip doesn't burn all retries
  // in six seconds.
  const delayMs = BACKOFF_BASE_MS * 2 ** (job.attempts - 1);
  await sql`
    UPDATE jobs
    SET status = 'queued',
        last_error = ${message},
        run_after = now() + (${delayMs} || ' milliseconds')::interval
    WHERE id = ${job.id}
  `;
  console.warn(
    `[worker] job ${job.id} attempt ${job.attempts} failed, retrying in ${delayMs}ms: ${message}`,
  );
}

async function tick(): Promise<boolean> {
  const job = await claimJob();
  if (!job) return false;

  try {
    if (job.type === "extract") {
      await runExtractJob(job);
    } else {
      throw new Error(`Unknown job type: ${job.type}`);
    }
  } catch (err) {
    await failJob(job, err);
  }
  return true;
}

async function main() {
  console.log("[worker] started");

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      console.log(`[worker] ${signal} received, finishing current job…`);
      shuttingDown = true;
    });
  }

  while (!shuttingDown) {
    try {
      // Drain continuously while there is work, then idle.
      const didWork = await tick();
      if (!didWork) await sleep(POLL_INTERVAL_MS);
    } catch (err) {
      // A failure here means the database itself is unreachable. Keep the loop
      // alive so the worker recovers when Postgres comes back.
      console.error("[worker] loop error:", err);
      await sleep(POLL_INTERVAL_MS * 5);
    }
  }

  await sql.end({ timeout: 5 });
  console.log("[worker] stopped");
  process.exit(0);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
