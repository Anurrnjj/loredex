import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Postgres `tsvector`. Drizzle has no native type for it, and we never write
 * to it from application code — it is a generated column maintained by
 * Postgres itself (see the migration in drizzle/). We declare it so the type
 * exists for queries.
 */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

// --- enums -----------------------------------------------------------------

/** Drives which renderer the viewer picks and which extractor the worker runs. */
export const documentKind = pgEnum("document_kind", [
  "markdown",
  "pdf",
  "code",
  "text",
  "office",
  "archive",
  "other",
]);

export const visibility = pgEnum("visibility", [
  "private",
  "unlisted", // reachable by link, absent from other users' search
  "public", // reachable by link and searchable by everyone
]);

export const documentStatus = pgEnum("document_status", [
  "pending", // row exists, worker hasn't picked it up
  "processing",
  "ready",
  "failed",
]);

export const jobStatus = pgEnum("job_status", [
  "queued",
  "running",
  "done",
  "failed",
]);

// --- users -----------------------------------------------------------------

/**
 * Mirrors Clerk. `id` is the Clerk user ID (e.g. `user_2abc…`) — Clerk owns
 * identity, this table exists so documents have something to join against for
 * "uploaded by". Kept in sync by the /api/webhooks/clerk handler.
 */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- collections -----------------------------------------------------------

/** Optional grouping — roughly "the project this document came from". */
export const collections = pgTable(
  "collections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("collections_owner_slug_idx").on(t.ownerId, t.slug),
    index("collections_owner_idx").on(t.ownerId),
  ],
);

// --- documents -------------------------------------------------------------

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    collectionId: uuid("collection_id").references(() => collections.id, {
      onDelete: "set null",
    }),

    title: text("title").notNull(),
    description: text("description"),

    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    kind: documentKind("kind").notNull().default("other"),
    sizeBytes: integer("size_bytes").notNull(),

    /** Key within the S3 bucket. Never exposed to the browser directly. */
    storageKey: text("storage_key").notNull(),
    checksum: text("checksum"),

    visibility: visibility("visibility").notNull().default("private"),
    status: documentStatus("status").notNull().default("pending"),
    /** Populated when status = 'failed'; surfaced in the UI with a retry. */
    failureReason: text("failure_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("documents_owner_idx").on(t.ownerId),
    index("documents_collection_idx").on(t.collectionId),
    index("documents_created_idx").on(t.createdAt.desc()),
    // Supports the public-feed query without scanning private rows.
    index("documents_visibility_idx").on(t.visibility),
    // Trigram index for typo-tolerant title matching ("dcoker" -> "docker").
    index("documents_title_trgm_idx").using(
      "gin",
      sql`${t.title} gin_trgm_ops`,
    ),
  ],
);

// --- extracted content + search index --------------------------------------

/**
 * Split from `documents` deliberately: extracted text can be megabytes, and
 * keeping it out of the main table keeps listing queries cheap.
 *
 * `title` and `tagsText` are denormalized copies, refreshed by the worker
 * whenever the document or its tags change. They exist so `searchVector` can
 * be a *generated* column — Postgres generated columns may only reference
 * other columns in the same row.
 */
export const documentContent = pgTable(
  "document_content",
  {
    documentId: uuid("document_id")
      .primaryKey()
      .references(() => documents.id, { onDelete: "cascade" }),

    title: text("title").notNull().default(""),
    tagsText: text("tags_text").notNull().default(""),
    extractedText: text("extracted_text").notNull().default(""),

    pageCount: integer("page_count"),
    /** S3 key of a cached converted preview (PDF for pptx, HTML for docx). */
    previewKey: text("preview_key"),
    previewMime: text("preview_mime"),

    searchVector: tsvector("search_vector"),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("document_content_search_idx").using("gin", t.searchVector)],
);

// --- tags ------------------------------------------------------------------

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Always lowercased and trimmed before insert — see lib/tags.ts. */
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("tags_name_idx").on(t.name)],
);

export const documentTags = pgTable(
  "document_tags",
  {
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.tagId] }),
    index("document_tags_tag_idx").on(t.tagId),
  ],
);

// --- zip contents ----------------------------------------------------------

/**
 * One row per entry inside an uploaded archive. Lets the viewer render a tree
 * without re-reading the zip, and lets search match a document by the text of
 * a file *inside* it (a zip containing a Dockerfile is findable via "docker").
 */
export const zipEntries = pgTable(
  "zip_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    isDirectory: boolean("is_directory").notNull().default(false),
    isText: boolean("is_text").notNull().default(false),
    /** Truncated content, for small text entries only. */
    textPreview: text("text_preview"),
  },
  (t) => [
    index("zip_entries_document_idx").on(t.documentId),
    uniqueIndex("zip_entries_document_path_idx").on(t.documentId, t.path),
  ],
);

// --- job queue -------------------------------------------------------------

/**
 * A Postgres-backed queue, drained by the worker with
 * `FOR UPDATE SKIP LOCKED`. Deliberately not Redis/BullMQ: one fewer container
 * for a library whose throughput is a handful of uploads a day.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    status: jobStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lastError: text("last_error"),
    /** Set into the future to back off after a failure. */
    runAfter: timestamp("run_after", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("jobs_claim_idx").on(t.status, t.runAfter),
    index("jobs_document_idx").on(t.documentId),
  ],
);

// --- inferred types ---------------------------------------------------------

export type User = typeof users.$inferSelect;
export type Collection = typeof collections.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type DocumentContent = typeof documentContent.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type ZipEntry = typeof zipEntries.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type DocumentKind = (typeof documentKind.enumValues)[number];
export type Visibility = (typeof visibility.enumValues)[number];
