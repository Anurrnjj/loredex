# Loredex

**lore + index** — your accumulated project lore, indexed and searchable.

Docs, prompt guides, reference PDFs, and zipped boilerplate from old projects
end up stranded in folders you never open again. Loredex indexes what is
*inside* each file, so when you start something new and think "how did I do
Docker last time?", you can find the actual document and read it in the browser.

Searching `docker` returns a zip from two years ago because there is a
Dockerfile inside it.

## What it does

- **Search-first.** After signing in, the page is a search box. Full-text search
  runs over extracted contents, titles, and tags — not just filenames.
- **Reads inside files.** Markdown, PDFs, Word, Excel, PowerPoint, source code,
  and the contents of zip archives.
- **Renders in the browser.** Markdown with syntax highlighting, paginated PDFs,
  Office documents, and a browsable tree for archives.
- **Multi-user with sharing.** Everything is private by default; any document
  can be made link-shareable or fully public.

## Stack

| | |
|---|---|
| Framework | Next.js 16 (App Router), TypeScript, Tailwind 4 |
| Database | Postgres 16 + Drizzle ORM |
| Search | Postgres full-text (`tsvector`, `websearch_to_tsquery`) + `pg_trgm` |
| Auth | Clerk |
| Storage | MinIO (S3 API) — swappable for Cloudflare R2 or AWS S3 |
| Extraction | pdf.js, mammoth, SheetJS, yauzl, LibreOffice headless |
| Deployment | Docker Compose behind Caddy, on Oracle Cloud Always Free |

## Local development

Requires Node 20+, pnpm, and Docker.

```bash
pnpm install
cp .env.example .env.local        # add your Clerk test keys
docker compose -f docker-compose.dev.yml up -d
pnpm db:migrate
pnpm storage:init
```

Then in two terminals:

```bash
pnpm dev        # http://localhost:3000
pnpm worker     # the extraction worker
```

Both are needed. Without the worker, uploads stay stuck on "Queued" — nothing
becomes searchable until it extracts them.

### Clerk in development

Test keys (`pk_test_…`) work on localhost with no DNS setup. For the webhook to
reach your machine you need a tunnel:

```bash
npx untun@latest tunnel http://localhost:3000
```

Point the Clerk webhook at `<tunnel-url>/api/webhooks/clerk`. If you skip this,
signing in still works — `ensureLocalUser()` in `src/lib/auth.ts` creates the
missing row as a fallback — but profile updates will not sync.

## Verifying

```bash
pnpm tsx scripts/test-extractors.ts   # every extractor against a real file
pnpm tsx scripts/e2e-check.ts         # upload → extract → search → access control
```

The e2e check needs the worker running. It creates two throwaway users, walks
the whole path a real upload takes, verifies search behaviour (phrases,
negation, typo tolerance, filters) and that one user cannot see another's
private documents, then cleans up after itself.

## Layout

```
src/
  app/
    (app)/            signed-in surfaces — home, search, upload, viewer, collections
    p/[id]/           public read-only document pages
    api/              presign, complete, files, status, health, Clerk webhook
    actions/          server actions (visibility, rename, tags, delete)
  components/
    viewers/          one renderer per document kind
  db/schema.ts        tables, enums, and the generated search_vector column
  lib/
    access.ts         the single place visibility rules are expressed
    queries.ts        search, ranking, snippets
    s3.ts             presigned URLs; the only file that knows about storage
  worker/
    index.ts          job loop (FOR UPDATE SKIP LOCKED)
    extractors.ts     per-format text extraction and preview generation
  proxy.ts            Clerk auth gate (Next 16 renamed middleware.ts → proxy.ts)
```

## Notes on a few decisions

**Why a separate worker.** Extracting a 300-page PDF or shelling out to
LibreOffice takes seconds to minutes. In a web request that means timeouts and
a UI that appears hung. Uploads return immediately as `pending` and the page
updates as the worker progresses.

**Why direct-to-storage uploads.** The browser requests a presigned URL and PUTs
the bytes straight to storage. A 300 MB zip never touches the app process, so
there is no body limit or execution ceiling to work around.

**Why prefix expansion in search.** English stemming reduces "Dockerfile" to
`dockerfil`, which the term `docker` does not match. Without prefix expansion, a
zip containing a Dockerfile would be invisible to a search for "docker" — the
exact case this app exists for. It is disabled for quoted or negated queries,
where the user has said precisely what they meant.

**Why the search snippets use control characters.** `ts_headline` does not
escape the text it highlights, so asking it for `<mark>` tags directly would let
a document containing `<script>` inject it into the results page. Postgres marks
matches with two control bytes that cannot survive extraction sanitising; the
snippet is HTML-escaped and only then are those bytes turned into real tags.

**Why not serverless.** LibreOffice is needed for PowerPoint and the legacy
binary Office formats. That requires a container image, which rules out Vercel
and friends.

## Deployment

See [DEPLOY.md](./DEPLOY.md) — Oracle Cloud Always Free, with an AWS appendix.
