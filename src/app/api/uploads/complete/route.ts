import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { collections, documentContent, documents, jobs } from "@/db/schema";
import { UnauthorizedError, requireUserId } from "@/lib/auth";
import { detectKind } from "@/lib/file-kinds";
import { bucket, getS3 } from "@/lib/s3";
import { setDocumentTags } from "@/lib/tags";
import { slugify } from "@/lib/utils";

const bodySchema = z.object({
  documentId: z.string().uuid(),
  storageKey: z.string().min(1),
  filename: z.string().min(1).max(255),
  mimeType: z.string().max(255),
  title: z.string().max(300).optional(),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string()).max(24).default([]),
  visibility: z.enum(["private", "unlisted", "public"]).default("private"),
  collectionName: z.string().max(120).optional(),
});

/**
 * Records an uploaded file and queues it for extraction.
 *
 * Returns as soon as the row is written — extraction happens in the worker, so
 * a 300-page PDF does not hold the request open. The UI shows the document
 * immediately with status `pending` and updates as the worker progresses.
 */
export async function POST(req: Request) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return Response.json({ error: "Not signed in" }, { status: 401 });
    }
    throw err;
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const body = parsed.data;

  // The storage key encodes the owner. Verifying it belongs to this user stops
  // a caller from claiming someone else's object as their own document.
  if (!body.storageKey.startsWith(`docs/${userId}/${body.documentId}/`)) {
    return Response.json({ error: "Invalid storage key" }, { status: 403 });
  }

  // Confirm the object actually landed — otherwise a failed browser upload
  // creates a document row pointing at nothing, which the worker then reports
  // as a mysterious extraction failure.
  let sizeBytes: number;
  try {
    const head = await getS3().send(
      new HeadObjectCommand({ Bucket: bucket(), Key: body.storageKey }),
    );
    sizeBytes = head.ContentLength ?? 0;
  } catch {
    return Response.json(
      { error: "Upload not found in storage. Please try again." },
      { status: 400 },
    );
  }

  const collectionId = body.collectionName
    ? await upsertCollection(userId, body.collectionName)
    : null;

  const title = body.title?.trim() || stripExtension(body.filename);
  const kind = detectKind(body.filename, body.mimeType);

  await db.transaction(async (tx) => {
    await tx.insert(documents).values({
      id: body.documentId,
      ownerId: userId,
      collectionId,
      title,
      description: body.description ?? null,
      originalFilename: body.filename,
      mimeType: body.mimeType,
      kind,
      sizeBytes,
      storageKey: body.storageKey,
      visibility: body.visibility,
      status: "pending",
    });

    // The content row must exist before tags are written, and carries the
    // denormalized title the generated search_vector reads.
    await tx
      .insert(documentContent)
      .values({ documentId: body.documentId, title })
      .onConflictDoUpdate({
        target: documentContent.documentId,
        set: { title },
      });

    await tx.insert(jobs).values({
      documentId: body.documentId,
      type: "extract",
    });
  });

  if (body.tags.length > 0) {
    await setDocumentTags(body.documentId, body.tags);
  }

  return Response.json({ id: body.documentId, status: "pending" });
}

async function upsertCollection(ownerId: string, name: string) {
  const slug = slugify(name);
  if (!slug) return null;

  const existing = await db
    .select({ id: collections.id })
    .from(collections)
    .where(and(eq(collections.ownerId, ownerId), eq(collections.slug, slug)))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const inserted = await db
    .insert(collections)
    .values({ ownerId, name: name.trim(), slug })
    .returning({ id: collections.id });
  return inserted[0].id;
}

function stripExtension(filename: string) {
  const base = filename.split("/").pop() ?? filename;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}
