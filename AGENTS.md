<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Loredex

A searchable personal document library. See README.md for what it does and
DEPLOY.md for how it ships.

## Things that will bite you

**`proxy.ts`, not `middleware.ts`.** Next 16 renamed it. Clerk's
`clerkMiddleware` still mounts there unchanged.

**Never read `env()` at module scope.** `next build` imports every route to
collect metadata, so a module-level `env()` call makes the build require
runtime secrets. `src/db/index.ts` and `src/lib/s3.ts` both construct their
clients lazily for exactly this reason — keep it that way.

**`document_content.search_vector` is a generated column.** Postgres maintains
it; never write to it. Because generated columns may only reference their own
row, `title` and `tags_text` are denormalized copies on that table. If you
change a document's title or tags, update the copy in `document_content` too or
the change silently stops being searchable while still displaying correctly.
See `renameDocument` in `src/app/actions/documents.ts` and `setDocumentTags`.

**`ts_headline` does not escape its input.** Snippets are marked with control
bytes and escaped in `highlightToHtml()` before becoming `<mark>` tags. Asking
Postgres for HTML tags directly is an XSS hole.

**Access control lives in one place.** `src/lib/access.ts`. Every read path
goes through `canReadFilter` / `canDiscoverFilter` / `getReadableDocument`, and
every mutation through `requireOwnedDocument`. Do not hand-roll
`WHERE owner_id = …` in a route.

**The AWS SDK sends checksum headers MinIO rejects.** `requestChecksumCalculation:
"WHEN_REQUIRED"` in `src/lib/s3.ts` is load-bearing.

**MinIO has no `PutBucketCors`.** CORS is server config
(`MINIO_API_CORS_ALLOW_ORIGIN` in the compose files), not a bucket policy.

## Conventions

- Server components by default; `"use client"` only for real interactivity.
- Design tokens are CSS variables in `globals.css` (Tailwind 4 is CSS-first).
  Use `bg-surface`, `text-fg-muted`, `border-border` — not raw Tailwind colours.
  Semantic colour (`warn`/`danger`/`ok`) is reserved for status only.
- Comments explain *why*, not what. Load-bearing non-obvious decisions get one.

## Verifying changes

```bash
pnpm typecheck
pnpm tsx scripts/test-extractors.ts   # needs `soffice` on PATH
pnpm tsx scripts/e2e-check.ts         # needs `pnpm worker` running
```

The e2e check covers upload → extraction → search semantics → access control
against real Postgres and MinIO. Run it after touching search, the worker, or
anything in `lib/access.ts`.
