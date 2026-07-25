"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { documentContent, documents } from "@/db/schema";
import { requireOwnedDocument } from "@/lib/access";
import { requireUserId } from "@/lib/auth";
import { deleteObject } from "@/lib/s3";
import { setDocumentTags } from "@/lib/tags";
import { getDocumentContent } from "@/lib/queries";

const visibilitySchema = z.enum(["private", "unlisted", "public"]);

/** Changes who can see a document. Owner only. */
export async function setVisibility(documentId: string, next: string) {
  const userId = await requireUserId();
  const parsed = visibilitySchema.parse(next);

  await requireOwnedDocument(documentId, userId);

  await db
    .update(documents)
    .set({ visibility: parsed, updatedAt: new Date() })
    .where(eq(documents.id, documentId));

  revalidatePath(`/d/${documentId}`);
  return { visibility: parsed };
}

/** Retitles a document, keeping the denormalized search copy in step. */
export async function renameDocument(documentId: string, title: string) {
  const userId = await requireUserId();
  const clean = title.trim().slice(0, 300);
  if (!clean) throw new Error("Title cannot be empty");

  await requireOwnedDocument(documentId, userId);

  await db.transaction(async (tx) => {
    await tx
      .update(documents)
      .set({ title: clean, updatedAt: new Date() })
      .where(eq(documents.id, documentId));

    // The generated search_vector reads this copy, not documents.title.
    await tx
      .update(documentContent)
      .set({ title: clean, updatedAt: new Date() })
      .where(eq(documentContent.documentId, documentId));
  });

  revalidatePath(`/d/${documentId}`);
}

export async function updateTags(documentId: string, tags: string[]) {
  const userId = await requireUserId();
  await requireOwnedDocument(documentId, userId);
  const applied = await setDocumentTags(documentId, tags);
  revalidatePath(`/d/${documentId}`);
  return applied;
}

/**
 * Deletes a document and its stored bytes.
 *
 * The database rows cascade; storage does not, so the objects are removed
 * explicitly. Storage errors are swallowed deliberately — an orphaned object
 * costs disk space, whereas a failed delete that leaves the row behind means
 * the user sees a document they asked to remove.
 */
export async function deleteDocument(documentId: string) {
  const userId = await requireUserId();
  const doc = await requireOwnedDocument(documentId, userId);
  const content = await getDocumentContent(documentId);

  await db.delete(documents).where(eq(documents.id, documentId));

  for (const key of [doc.storageKey, content?.previewKey]) {
    if (!key) continue;
    try {
      await deleteObject(key);
    } catch (err) {
      console.error(`[delete] orphaned storage object ${key}:`, err);
    }
  }

  revalidatePath("/");
}
