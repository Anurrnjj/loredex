import { desc, eq, inArray } from "drizzle-orm";

import { db, sql } from "@/db";
import {
  collections,
  documentContent,
  documentTags,
  documents,
  tags,
  type DocumentKind,
  type Visibility,
} from "@/db/schema";
import { canDiscoverFilter } from "./access";

/**
 * Turns a ts_headline result into safe HTML.
 *
 * Everything is HTML-escaped first, then the control-character sentinels
 * Postgres inserted around matches become `<mark>` tags. The result contains
 * no markup that did not originate here, which is what makes it safe to render
 * with dangerouslySetInnerHTML.
 */
export function highlightToHtml(raw: string | null): string | null {
  if (!raw) return null;
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\u0002/g, "<mark>")
    .replace(/\u0003/g, "</mark>");
}

export type SearchHit = {
  id: string;
  title: string;
  kind: DocumentKind;
  visibility: Visibility;
  sizeBytes: number;
  originalFilename: string;
  createdAt: Date;
  ownerId: string;
  collectionName: string | null;
  collectionSlug: string | null;
  /** Escaped HTML containing only the `<mark>` tags highlightToHtml() added. */
  snippet: string | null;
  tags: string[];
  rank: number;
};

export type SearchParams = {
  q: string;
  viewerId: string | null;
  kind?: DocumentKind;
  tag?: string;
  collectionSlug?: string;
  /** "mine" restricts to the viewer's own library; "all" includes public docs. */
  scope?: "mine" | "all";
  limit?: number;
  offset?: number;
};

/**
 * Full-text search over titles, tags, and extracted body text.
 *
 * Written as raw SQL rather than the query builder because the ranking and
 * snippet functions (`ts_rank_cd`, `ts_headline`) have no Drizzle equivalent,
 * and expressing the fallback branch in the builder obscures what Postgres
 * actually runs. Every value is still a bound parameter.
 *
 * Two-stage matching:
 *  1. `websearch_to_tsquery` — handles quoted phrases and `-exclusions` the way
 *     users expect from a search engine.
 *  2. If that returns nothing, a trigram similarity pass on the title catches
 *     typos ("dcoker" still finds Docker).
 */
export async function searchDocuments({
  q,
  viewerId,
  kind,
  tag,
  collectionSlug,
  scope = "all",
  limit = 30,
  offset = 0,
}: SearchParams): Promise<SearchHit[]> {
  const query = q.trim();
  if (!query) return [];

  // Quotes, negation, and explicit OR mean the user said exactly what they
  // wanted. Prefix expansion and the fuzzy fallback both second-guess that, so
  // they are switched off for these queries — `docker -compose` must not come
  // back with the Compose document via a side door.
  const hasOperators = /["]|(?:^|\s)-\S|\bor\b/i.test(query);

  /*
   * Prefix expansion. English stemming reduces "Dockerfile" to `dockerfil`,
   * which the term `docker` does not match — so without this, a zip containing
   * a Dockerfile is invisible to a search for "docker", which is exactly the
   * case this whole app exists to serve.
   *
   * The expansion is OR-ed with the literal query rather than replacing it, so
   * exact matches still outrank prefix ones under ts_rank_cd.
   */
  const prefixTerms = hasOperators
    ? []
    : (query.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? []).slice(0, 8);
  const prefixQuery =
    prefixTerms.length > 0 ? prefixTerms.map((t) => `${t}:*`).join(" & ") : null;

  const tsQuery = prefixQuery
    ? sql`(websearch_to_tsquery('english', ${query}) || to_tsquery('english', ${prefixQuery}))`
    : sql`websearch_to_tsquery('english', ${query})`;

  const visibilityClause =
    scope === "mine" && viewerId
      ? sql`d.owner_id = ${viewerId}`
      : viewerId
        ? sql`(d.owner_id = ${viewerId} OR d.visibility = 'public')`
        : sql`d.visibility = 'public'`;

  const kindClause = kind ? sql`AND d.kind = ${kind}` : sql``;
  const collectionClause = collectionSlug
    ? sql`AND c.slug = ${collectionSlug}`
    : sql``;
  const tagClause = tag
    ? sql`AND EXISTS (
        SELECT 1 FROM document_tags dt
        JOIN tags t ON t.id = dt.tag_id
        WHERE dt.document_id = d.id AND t.name = ${tag}
      )`
    : sql``;

  const rows = await sql<
    Array<{
      id: string;
      title: string;
      kind: DocumentKind;
      visibility: Visibility;
      size_bytes: number;
      original_filename: string;
      created_at: Date;
      owner_id: string;
      collection_name: string | null;
      collection_slug: string | null;
      snippet: string | null;
      tags: string[] | null;
      rank: number;
    }>
  >`
    WITH q AS (SELECT ${tsQuery} AS tsq)
    SELECT
      d.id,
      d.title,
      d.kind,
      d.visibility,
      d.size_bytes,
      d.original_filename,
      d.created_at,
      d.owner_id,
      c.name AS collection_name,
      c.slug AS collection_slug,
      -- Marked with control characters rather than <mark> tags: ts_headline
      -- does NOT escape the source text, so emitting HTML here would let a
      -- document containing <script> inject it into the results page. These
      -- two bytes cannot survive sanitizeText(), so they are unforgeable
      -- sentinels. highlightToHtml() escapes, then swaps them for real tags.
      ts_headline(
        'english',
        COALESCE(NULLIF(dc.extracted_text, ''), d.description, d.title),
        q.tsq,
        'StartSel=' || chr(2) || ', StopSel=' || chr(3) ||
        ', MaxWords=32, MinWords=12, ShortWord=3, MaxFragments=2, FragmentDelimiter=" … "'
      ) AS snippet,
      ARRAY(
        SELECT t.name FROM document_tags dt
        JOIN tags t ON t.id = dt.tag_id
        WHERE dt.document_id = d.id
        ORDER BY t.name
      ) AS tags,
      ts_rank_cd(dc.search_vector, q.tsq) AS rank
    FROM documents d
    CROSS JOIN q
    JOIN document_content dc ON dc.document_id = d.id
    LEFT JOIN collections c ON c.id = d.collection_id
    WHERE dc.search_vector @@ q.tsq
      AND d.status = 'ready'
      AND ${visibilityClause}
      ${kindClause}
      ${collectionClause}
      ${tagClause}
    ORDER BY rank DESC, d.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  if (rows.length > 0) return rows.map(toHit);

  // No fuzzy rescue for operator queries: `docker -compose` returning zero
  // results is the correct answer, and a similarity match on the title would
  // hand back the very document the user excluded.
  if (hasOperators) return [];

  // Fallback: trigram similarity on the title, for typos.
  const fuzzy = await sql<
    Array<{
      id: string;
      title: string;
      kind: DocumentKind;
      visibility: Visibility;
      size_bytes: number;
      original_filename: string;
      created_at: Date;
      owner_id: string;
      collection_name: string | null;
      collection_slug: string | null;
      snippet: string | null;
      tags: string[] | null;
      rank: number;
    }>
  >`
    SELECT
      d.id, d.title, d.kind, d.visibility, d.size_bytes,
      d.original_filename, d.created_at, d.owner_id,
      c.name AS collection_name,
      c.slug AS collection_slug,
      d.description AS snippet,
      ARRAY(
        SELECT t.name FROM document_tags dt
        JOIN tags t ON t.id = dt.tag_id
        WHERE dt.document_id = d.id
        ORDER BY t.name
      ) AS tags,
      similarity(d.title, ${query}) AS rank
    FROM documents d
    LEFT JOIN collections c ON c.id = d.collection_id
    WHERE d.status = 'ready'
      AND similarity(d.title, ${query}) > 0.2
      AND ${visibilityClause}
      ${kindClause}
      ${collectionClause}
      ${tagClause}
    ORDER BY rank DESC
    LIMIT ${limit}
  `;

  return fuzzy.map(toHit);
}

function toHit(r: {
  id: string;
  title: string;
  kind: DocumentKind;
  visibility: Visibility;
  size_bytes: number;
  original_filename: string;
  created_at: Date;
  owner_id: string;
  collection_name: string | null;
  collection_slug: string | null;
  snippet: string | null;
  tags: string[] | null;
  rank: number;
}): SearchHit {
  return {
    id: r.id,
    title: r.title,
    kind: r.kind,
    visibility: r.visibility,
    sizeBytes: r.size_bytes,
    originalFilename: r.original_filename,
    createdAt: r.created_at,
    ownerId: r.owner_id,
    collectionName: r.collection_name,
    collectionSlug: r.collection_slug,
    // Sanitized here, at the single point every hit passes through, so no
    // caller can render a raw headline by mistake.
    snippet: highlightToHtml(r.snippet),
    tags: r.tags ?? [],
    rank: Number(r.rank),
  };
}

// --- listings ---------------------------------------------------------------

/** Recent documents for the home page, respecting visibility. */
export async function recentDocuments(viewerId: string | null, limit = 12) {
  const filter = canDiscoverFilter(viewerId);
  return db
    .select({
      id: documents.id,
      title: documents.title,
      kind: documents.kind,
      status: documents.status,
      visibility: documents.visibility,
      sizeBytes: documents.sizeBytes,
      createdAt: documents.createdAt,
      collectionName: collections.name,
    })
    .from(documents)
    .leftJoin(collections, eq(collections.id, documents.collectionId))
    .where(filter)
    .orderBy(desc(documents.createdAt))
    .limit(limit);
}

/** Tag cloud for the home page: most-used tags across visible documents. */
export async function topTags(viewerId: string | null, limit = 24) {
  const rows = await sql<Array<{ name: string; count: number }>>`
    SELECT t.name, COUNT(*)::int AS count
    FROM tags t
    JOIN document_tags dt ON dt.tag_id = t.id
    JOIN documents d ON d.id = dt.document_id
    WHERE d.status = 'ready'
      AND ${
        viewerId
          ? sql`(d.owner_id = ${viewerId} OR d.visibility = 'public')`
          : sql`d.visibility = 'public'`
      }
    GROUP BY t.name
    ORDER BY count DESC, t.name ASC
    LIMIT ${limit}
  `;
  return rows;
}

export async function documentTagNames(documentId: string) {
  const rows = await db
    .select({ name: tags.name })
    .from(documentTags)
    .innerJoin(tags, eq(tags.id, documentTags.tagId))
    .where(eq(documentTags.documentId, documentId))
    .orderBy(tags.name);
  return rows.map((r) => r.name);
}

export async function listCollections(ownerId: string) {
  const rows = await sql<
    Array<{
      id: string;
      name: string;
      slug: string;
      description: string | null;
      count: number;
    }>
  >`
    SELECT c.id, c.name, c.slug, c.description,
           COUNT(d.id)::int AS count
    FROM collections c
    LEFT JOIN documents d ON d.collection_id = c.id
    WHERE c.owner_id = ${ownerId}
    GROUP BY c.id
    ORDER BY c.name ASC
  `;
  return rows;
}

/** Content row for the viewer. */
export async function getDocumentContent(documentId: string) {
  const rows = await db
    .select({
      extractedText: documentContent.extractedText,
      pageCount: documentContent.pageCount,
      previewKey: documentContent.previewKey,
      previewMime: documentContent.previewMime,
    })
    .from(documentContent)
    .where(eq(documentContent.documentId, documentId))
    .limit(1);
  return rows[0] ?? null;
}

/** Used by the upload page to offer existing collections. */
export async function collectionOptions(ownerId: string) {
  return db
    .select({ id: collections.id, name: collections.name })
    .from(collections)
    .where(eq(collections.ownerId, ownerId))
    .orderBy(collections.name);
}

export async function documentsByIds(ids: string[]) {
  if (ids.length === 0) return [];
  return db.select().from(documents).where(inArray(documents.id, ids));
}
