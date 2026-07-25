import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { documentContent, documentTags, tags } from "@/db/schema";
import { normalizeTag } from "./utils";

/**
 * Replaces a document's tags, creating any that don't exist yet.
 *
 * Also refreshes `document_content.tags_text`, the denormalized copy the
 * generated `search_vector` reads from — forget this and tags stop being
 * searchable while still displaying correctly, which is a confusing bug to
 * chase later.
 */
export async function setDocumentTags(documentId: string, rawTags: string[]) {
  const names = [...new Set(rawTags.map(normalizeTag).filter(Boolean))].slice(
    0,
    24,
  );

  await db.transaction(async (tx) => {
    await tx.delete(documentTags).where(eq(documentTags.documentId, documentId));

    if (names.length > 0) {
      await tx
        .insert(tags)
        .values(names.map((name) => ({ name })))
        .onConflictDoNothing({ target: tags.name });

      const rows = await tx
        .select({ id: tags.id, name: tags.name })
        .from(tags)
        .where(inArray(tags.name, names));

      await tx
        .insert(documentTags)
        .values(rows.map((r) => ({ documentId, tagId: r.id })))
        .onConflictDoNothing();
    }

    await tx
      .insert(documentContent)
      .values({ documentId, tagsText: names.join(" ") })
      .onConflictDoUpdate({
        target: documentContent.documentId,
        set: { tagsText: names.join(" "), updatedAt: new Date() },
      });
  });

  return names;
}
