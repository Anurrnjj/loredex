-- Required by documents_title_trgm_idx (typo-tolerant title matching).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('markdown', 'pdf', 'code', 'text', 'office', 'archive', 'other');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('pending', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('private', 'unlisted', 'public');--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_content" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"tags_text" text DEFAULT '' NOT NULL,
	"extracted_text" text DEFAULT '' NOT NULL,
	"page_count" integer,
	"preview_key" text,
	"preview_mime" text,
	-- Maintained by Postgres, never written by application code. Weighted so a
	-- title hit outranks a tag hit, which outranks a passing body mention.
	-- to_tsvector is immutable when the config is a literal, which is what
	-- makes it legal in a generated column.
	"search_vector" "tsvector" GENERATED ALWAYS AS (
		setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
		setweight(to_tsvector('english', coalesce("tags_text", '')), 'B') ||
		setweight(to_tsvector('english', coalesce("extracted_text", '')), 'C')
	) STORED,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_tags" (
	"document_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "document_tags_document_id_tag_id_pk" PRIMARY KEY("document_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"collection_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"kind" "document_kind" DEFAULT 'other' NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"checksum" text,
	"visibility" "visibility" DEFAULT 'private' NOT NULL,
	"status" "document_status" DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"last_error" text,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"display_name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zip_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"path" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"is_directory" boolean DEFAULT false NOT NULL,
	"is_text" boolean DEFAULT false NOT NULL,
	"text_preview" text
);
--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_content" ADD CONSTRAINT "document_content_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_tags" ADD CONSTRAINT "document_tags_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_tags" ADD CONSTRAINT "document_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zip_entries" ADD CONSTRAINT "zip_entries_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "collections_owner_slug_idx" ON "collections" USING btree ("owner_id","slug");--> statement-breakpoint
CREATE INDEX "collections_owner_idx" ON "collections" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "document_content_search_idx" ON "document_content" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "document_tags_tag_idx" ON "document_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "documents_owner_idx" ON "documents" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "documents_collection_idx" ON "documents" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "documents_created_idx" ON "documents" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "documents_visibility_idx" ON "documents" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "documents_title_trgm_idx" ON "documents" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "jobs_document_idx" ON "jobs" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_name_idx" ON "tags" USING btree ("name");--> statement-breakpoint
CREATE INDEX "zip_entries_document_idx" ON "zip_entries" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "zip_entries_document_path_idx" ON "zip_entries" USING btree ("document_id","path");