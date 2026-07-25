import { and, eq, or, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { documents, type Document } from "@/db/schema";
import { ForbiddenError } from "./auth";

/**
 * The single place visibility rules are expressed.
 *
 * Every read path — search, listings, the viewer, the file redirect — routes
 * through here. Hand-rolling `WHERE owner_id = ...` per route is how a private
 * document eventually leaks, so don't.
 */

/**
 * Rows a viewer may *retrieve by ID*. Unlisted documents are included: they are
 * link-shareable by design.
 */
export function canReadFilter(viewerId: string | null): SQL | undefined {
  const shareable = or(
    eq(documents.visibility, "public"),
    eq(documents.visibility, "unlisted"),
  );
  if (!viewerId) return shareable;
  return or(eq(documents.ownerId, viewerId), shareable);
}

/**
 * Rows a viewer may *discover through search or browsing*. Stricter than
 * `canReadFilter`: unlisted documents belonging to other people are omitted,
 * which is the entire point of "unlisted".
 */
export function canDiscoverFilter(viewerId: string | null): SQL | undefined {
  if (!viewerId) return eq(documents.visibility, "public");
  return or(
    eq(documents.ownerId, viewerId),
    eq(documents.visibility, "public"),
  );
}

/** Fetch a document if the viewer is allowed to read it, else null. */
export async function getReadableDocument(
  documentId: string,
  viewerId: string | null,
): Promise<Document | null> {
  const filter = canReadFilter(viewerId);
  const rows = await db
    .select()
    .from(documents)
    .where(filter ? and(eq(documents.id, documentId), filter) : undefined)
    .limit(1);
  return rows[0] ?? null;
}

/** Fetch a document the viewer owns, or throw. Used by every mutation. */
export async function requireOwnedDocument(
  documentId: string,
  viewerId: string,
): Promise<Document> {
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.ownerId, viewerId)))
    .limit(1);

  const doc = rows[0];
  // Deliberately the same error whether the document is missing or simply
  // someone else's — otherwise the response confirms that an ID exists.
  if (!doc) throw new ForbiddenError("Document not found");
  return doc;
}
