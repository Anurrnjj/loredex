# Loredex — Implementation + Deployment Plan

> **Loredex** (lore + index) — your accumulated project lore, indexed and searchable.
> Project root: `/home/anuranj/Desktop/loredex`. Domain: `loredex.yourdomain.com`.

## Context

You accumulate useful material across projects — setup docs, prompt guides, reference PDFs, zipped
boilerplate — and it gets stranded in old project folders. When you start something new you want to
ask "how did I do Docker last time?" and get the actual doc back, readable in the browser, without
digging through disks. Others should be able to benefit from the same library.

The product is therefore **search-first**: after login the landing page is a single search box.
Typing `docker` returns every doc whose title, tags, or *body text* mentions Docker, with a
highlighted snippet, and clicking one opens it rendered in-page (Markdown, PDF, code, Office, or a
browsable zip) rather than downloading it.

Greenfield — nothing exists yet. Node 20 and Docker are already installed locally.

## Decisions (confirmed)

| Area | Choice |
|---|---|
| Search | Postgres full-text over extracted content + tags (no AI/embeddings) |
| Accounts | Multi-user signup, per-user library, optional public sharing |
| Auth provider | **Clerk** |
| Viewer | Markdown, PDF, code, **zip browsing**, **Office (docx/xlsx/pptx)** |
| Hosting | **Oracle Cloud Always Free** (primary), AWS mapping documented as an appendix |
| Storage | **MinIO** container on the same VM (S3 API) |
| Domain | You have one — full HTTPS + Clerk production setup |

### Why MinIO (you asked what to pick)
The app needs somewhere to put file *bytes* — databases are bad at that. Three realistic options:

1. **Plain disk folder.** Simplest, but the app must stream every download itself, and moving hosts
   later means rewriting the file layer.
2. **Cloudflare R2 / AWS S3.** Proper object storage, but another account, another card on file, and
   an external dependency for a library that's mostly personal.
3. **MinIO — chosen.** An object-storage server that speaks the *exact same S3 API*, running as one
   more container next to Postgres, storing onto Oracle's free 200 GB block volume.

MinIO gets you the thing that actually matters — **presigned URLs**, so the browser uploads a 200 MB
zip straight to storage and downloads straight from it, never through the Next.js process. And
because it's the S3 API, switching to R2 or S3 later is three environment variables
(`S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`), not a code change. Pin the image to a known tag
(e.g. `RELEASE.2025-04-22T22-12-26Z`) rather than `:latest`.

---

## How Clerk works (you haven't used it before)

Clerk is **hosted authentication**. You don't write login forms, hash passwords, handle password
resets, verify emails, or store credentials. Clerk runs that; your app just asks "who is this
request from?" and gets back a user ID or `null`.

**The flow, concretely:**

1. User hits a protected page. Middleware sees no session → redirects to `/sign-in`.
2. `/sign-in` renders Clerk's `<SignIn />` React component — a complete, styled, working login UI
   (email code, Google, GitHub, whatever you enable in their dashboard). You write ~5 lines.
3. User authenticates *against Clerk's servers*. Clerk sets a session cookie on **your** domain.
4. Every later request: `@clerk/nextjs`'s middleware verifies that cookie's JWT locally using
   Clerk's public key — no network call per request — and exposes the user.
5. In any server component or route handler you call `const { userId } = await auth()`.
   `userId` is a string like `user_2abc...`. That's your foreign key.

**What you store yourself.** Clerk owns identity; *you* own the library. So you keep a local `users`
table whose primary key is Clerk's `userId`, holding only what your app needs (display name, avatar
URL, created-at). It's kept in sync by a **webhook**: Clerk POSTs to `/api/webhooks/clerk` on
`user.created` / `user.updated` / `user.deleted`, you verify the signature with `svix` (Clerk's
webhook library) and upsert the row. This matters — without it, a `documents.owner_id` has nothing
to join against for showing "uploaded by".

**The pieces you'll actually write:**

| File | Purpose |
|---|---|
| `src/middleware.ts` | `clerkMiddleware()` + `createRouteMatcher` marking `/`, `/search`, `/upload` private and `/p/*` (public docs) open |
| `src/app/layout.tsx` | wrap children in `<ClerkProvider>` |
| `src/app/sign-in/[[...sign-in]]/page.tsx` | `<SignIn />` — the catch-all route segment is required |
| `src/app/sign-up/[[...sign-up]]/page.tsx` | `<SignUp />` |
| `src/app/api/webhooks/clerk/route.ts` | svix-verified user sync into Postgres |
| `src/lib/auth.ts` | `requireUser()` helper wrapping `auth()`, throws/redirects if absent |

**Environment variables:** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
`CLERK_WEBHOOK_SIGNING_SECRET`.

**Development vs production instances.** Clerk gives you two. Dev keys (`pk_test_…`) work on
`localhost` immediately with zero DNS setup — that's what you build against. Production keys
(`pk_live_…`) require adding a few CNAME records on your domain (`clerk.yourdomain.com`,
`accounts.yourdomain.com`, plus DKIM records for their emails). Free plan covers both, up to 10,000
monthly active users. **Dev keys will not work on your real domain** — swapping them is a deployment
step, not an afterthought.

**Trade-off, stated plainly:** auth now depends on a third party. If Clerk is down, nobody logs in
(existing sessions survive until expiry). For a personal library that's a fine trade for deleting an
entire category of security work. The mitigation is that `owner_id` is just a string — migrating to
self-hosted auth later means changing the login layer, not the data model.

---

## Architecture — how the processes connect

```
                    Internet (your domain, HTTPS)
                              │
                    ┌─────────▼─────────┐
                    │   Caddy (:80/:443)│  auto TLS via Let's Encrypt
                    └────┬─────────┬────┘
        /               │         │        /s3/*  (presigned upload+download)
                    ┌────▼────┐    └──────────┐
                    │  web    │               │
                    │ Next.js │               │
                    │  :3000  │               │
                    └──┬───┬──┘          ┌────▼────┐
                       │   │             │  minio  │
              ┌────────┘   └────────┐    │  :9000  │
              │                     │    └────┬────┘
        ┌─────▼─────┐         ┌─────▼─────┐   │
        │ postgres  │◄────────┤  worker   ├───┘  pulls file, extracts text,
        │   :5432   │  jobs   │ (node)    │      writes preview back
        └───────────┘  table  └───────────┘
                              also runs `soffice` for pptx/legacy Office

        External: Clerk (auth API + webhook → web)
```

Five containers in one `docker-compose.yml`. `web` and `worker` are the **same image** with
different commands — one runs `next start`, the other runs the job loop. Only Caddy exposes ports to
the host; everything else talks over the internal compose network.

Why a separate worker: extracting text from a 300-page PDF or shelling out to LibreOffice takes
seconds to minutes. Doing that inside a web request means timeouts and a UI that hangs on upload.
Instead upload returns instantly with status `pending`, and the page live-updates as the worker
finishes.

---

## Stack

- **Next.js 15** (App Router, TypeScript, server actions) + **Tailwind** + **shadcn/ui**
- **Postgres 16** + **Drizzle ORM** (migrations checked into the repo)
- **Clerk** for auth
- **MinIO** (S3 API) via `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`
- **Caddy** as reverse proxy — chosen over nginx because automatic HTTPS is genuinely two lines
- Job queue: a **Postgres `jobs` table** polled with `FOR UPDATE SKIP LOCKED`. Deliberately not
  Redis/BullMQ — one less container for a low-volume personal library.

---

## Data model (`src/db/schema.ts`)

- `users` — `id` (Clerk user ID, text PK), `email`, `display_name`, `avatar_url`, `created_at`
- `collections` — optional grouping, roughly "the project this came from": `id`, `owner_id`, `name`, `slug`
- `documents` — `id`, `owner_id`, `collection_id`, `title`, `description`, `original_filename`,
  `mime_type`, `kind` (`markdown|pdf|code|text|office|archive|other`), `size_bytes`, `storage_key`,
  `checksum`, `visibility` (`private|unlisted|public`), `status`
  (`pending|processing|ready|failed`), `created_at`
- `document_content` — `document_id` PK/FK, `extracted_text`, `page_count`, `preview_key`
  (cached converted PDF/HTML in MinIO), denormalized `title` + `tags_text`, and `search_vector`
- `tags` (lowercase-normalized, unique) + `document_tags` join
- `zip_entries` — `document_id`, `path`, `size_bytes`, `is_text`, `text_preview`
- `jobs` — `document_id`, `type`, `status`, `attempts`, `last_error`, `run_after`

### Search index
`document_content.search_vector` is a **generated** `tsvector`, weighted so a title hit outranks a
passing body mention:

```sql
setweight(to_tsvector('english', coalesce(title,'')),         'A') ||
setweight(to_tsvector('english', coalesce(tags_text,'')),     'B') ||
setweight(to_tsvector('english', coalesce(extracted_text,'')),'C')
```

GIN index on it; `pg_trgm` GIN index on `documents.title` for typo tolerance. Queries use
`websearch_to_tsquery` (so `docker -compose` and `"multi stage"` behave as users expect), rank with
`ts_rank_cd`, snippet with `ts_headline`.

---

## Ingestion pipeline (`src/worker/`)

Browser asks `/api/uploads/presign` → uploads bytes directly to MinIO → calls
`/api/uploads/complete` → row inserted with status `pending` + an `extract` job. Worker picks it up:

| Input | Text extraction | Preview strategy |
|---|---|---|
| `.md`, `.txt`, code | read UTF-8 | render client-side |
| `.pdf` | `pdfjs-dist` text layer | stream original to `react-pdf` |
| `.docx` | `mammoth` | `mammoth` → sanitized HTML, cached in MinIO |
| `.xlsx`/`.csv` | SheetJS | SheetJS → HTML table |
| `.pptx`, legacy `.doc/.ppt/.xls` | via the converted PDF | `soffice --headless --convert-to pdf`, cache PDF |
| `.zip` | `yauzl`: index entry paths + text of small text entries | in-app tree browser |

LibreOffice runs only for pptx/legacy — the common `.docx`/`.xlsx` paths stay pure-JS and fast.
Extracted text is capped (~2 MB/doc) to keep `tsvector` sane. Note this makes the image large
(~700 MB with `libreoffice-core` + fonts); acceptable on a 200 GB volume.

---

## Routes

- `/sign-in`, `/sign-up` — Clerk components
- `/` — **search-first**: centered search box, recent uploads and top tags below
- `/search?q=&kind=&tag=&collection=&scope=` — results with kind icon, title, collection, tags,
  highlighted snippet; debounced type-ahead
- `/d/[id]` — viewer; renderer chosen by `kind`; sidebar with tags, collection, size, download,
  visibility toggle, copy-link
- `/d/[id]/zip/*path` — one entry inside a zip
- `/p/[id]` — public read-only doc page (no auth required)
- `/upload` — drag-drop multi-file, per-file title/tags/collection/visibility, live status
- `/collections`, `/collections/[slug]`
- `/api/files/[id]` — authorizes, then 302s to a ~5-minute presigned GET

## Access control

Every read goes through one shared helper (`src/lib/access.ts`) that appends
`WHERE owner_id = :me OR visibility IN ('public','unlisted')`. Never hand-rolled per route — that's
how a private doc leaks. Presigned URLs are minted only *after* that check passes.

---

## UI/UX design system

There's no "ui/ux" skill installed on this machine (only `graphify`), so the design direction is
specified here directly rather than delegated. The aesthetic target: **a fast, quiet, keyboard-driven
reference tool** — closer to Linear or Raycast than to a CMS. The content is the interest; the
chrome should get out of the way.

**Tokens** (CSS variables in `globals.css`, light + dark, dark is default):

- Surfaces: `--bg` near-black `#0B0C0E` / paper `#FCFCFD`; `--surface` one step up; `--border` at
  ~8% contrast so cards read as edges, not boxes
- Text: `--fg` at ~92% opacity (never pure white — it vibrates), `--fg-muted` ~60%, `--fg-subtle` ~40%
- One accent (indigo `#6366F1`) used *only* for focus rings, the active nav item, and search-term
  highlights. Semantic colors reserved strictly for status: amber = processing, red = failed.
- Radius 8px, one shadow token, 4px spacing grid

**Type:** Inter (or `system-ui`) for UI, JetBrains Mono for code and filenames. Scale
12/14/16/20/28. Rendered Markdown body gets `max-width: 68ch` and `line-height: 1.7` — long-form
docs are for reading, so this is where the design should feel generous.

**The five screens that decide whether this feels good:**

1. **Home.** Deliberately near-empty: centered search input at ~40% viewport height, `⌘K` hint
   inside it, recent docs and a tag cloud below the fold. Resist adding a dashboard.
2. **Search results.** One row per doc: kind icon, title, snippet with matches in accent, then
   tags/collection/date in `--fg-subtle`. Rows are 2–3 lines, generously spaced, whole row
   clickable. `↑`/`↓` to move, `Enter` to open, `/` to refocus search. Filters are a quiet chip row,
   not a sidebar.
3. **Viewer.** Content column centered, thin sticky metadata sidebar right (collapses under 1024px),
   auto-generated heading outline for long Markdown/PDFs. Sticky breadcrumb, `Esc` returns to results.
4. **Upload.** Full-page drop zone. Each file becomes a card with an inline progress bar, then a
   status pill that transitions `pending → processing → ready` live. Tags editable inline while it
   processes — no modal.
5. **Empty and failed states.** Every empty state names the next action ("Nothing here yet —
   upload your first doc"). Failed extraction shows the actual reason plus a Retry button; a silent
   failure in an archive you trust is worse than a loud one.

**Non-negotiables:** visible focus rings on everything (`:focus-visible`, never `outline: none`);
skeletons instead of spinners for search and lists; `prefers-reduced-motion` respected; AA contrast
minimum; every destructive action confirms; the whole app usable from the keyboard.

---

## Build order

0. **Create `/home/anuranj/Desktop/loredex`** and `git init` it.
1. **Scaffold** — Next.js + Tailwind + shadcn, Drizzle, design tokens, local `docker-compose.dev.yml`
   (Postgres + MinIO), `.env.example`, `.gitignore` covering `.env*` and `/data`.
2. **Clerk** — provider, middleware, sign-in/up pages, webhook + `users` sync. Verify locally with
   the Clerk CLI tunnel or ngrok so webhooks actually reach localhost.
3. **Upload + pipeline** — presign/complete, jobs table, worker loop, md/txt/code/pdf extraction.
4. **Search** — `search_vector` migration, search API, `/search` UI, home page.
5. **Viewer** — Markdown (`react-markdown` + `remark-gfm` + `shiki`), PDF (`react-pdf`), code.
6. **Office + zip** — mammoth/SheetJS/LibreOffice converters, zip tree browser.
7. **Sharing** — visibility toggle, `/p/[id]` public pages.
8. **Deploy** — the guide below.

---

## Deployment guide — Oracle Cloud Always Free

**Why Oracle over AWS here:** Oracle's Always Free tier gives 4 ARM (Ampere) cores and 24 GB RAM,
free with no expiry. AWS Free Tier gives a 1 GB `t3.micro` for 12 months. Postgres + MinIO +
Next.js + LibreOffice will not fit comfortably in 1 GB, and it stops being free after a year. Oracle
is the right call; AWS is mapped in the appendix.

**Caveat worth knowing up front:** Oracle's signup rejects some cards/regions, and free ARM capacity
is genuinely scarce in popular regions — you may get "out of capacity" and need to retry or pick a
different home region. Confirm you can actually launch the VM before building around it.

### 1. Provision
- Create the VM: **Ampere A1**, 4 OCPU / 24 GB, Ubuntu 22.04 (arm64 — matters for image builds).
- Save the SSH private key at creation. It is not recoverable afterwards.
- Boot volume 50 GB + a 150 GB block volume mounted at `/data` for Postgres and MinIO.
- **VCN Security List:** allow ingress on 80 and 443 only. Leave 22 restricted to your IP.
- **Then also open them in the OS firewall** — Oracle's Ubuntu images ship with iptables rules that
  silently drop traffic even when the cloud security list allows it. This trips up nearly everyone:
  ```
  sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
  sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
  sudo netfilter-persistent save
  ```

### 2. Host setup
Install Docker Engine + compose plugin, add your user to the `docker` group, enable
`docker` at boot. Create `/data/{postgres,minio}` with correct ownership.

### 3. DNS + Clerk production
- `A` record: `loredex.yourdomain.com` → the VM's public IP.
- In Clerk dashboard, create the **production instance** for that domain; add the CNAME records it
  gives you (`clerk`, `accounts`, plus DKIM). Propagation is usually minutes, occasionally hours.
- Copy the `pk_live_…` / `sk_live_…` keys into the server `.env`.
- Point the production webhook at `https://loredex.yourdomain.com/api/webhooks/clerk` and copy the new
  signing secret — **it differs from the dev one.**

### 4. Compose stack
`docker-compose.prod.yml` with five services:

- `caddy` — ports 80/443, two-line `Caddyfile` reverse-proxying `loredex.yourdomain.com` → `web:3000`
  and `s3.yourdomain.com` → `minio:9000` (MinIO needs to be reachable from the browser for
  presigned upload/download to work). TLS is automatic.
- `postgres` — volume `/data/postgres`, no published port, healthcheck
- `minio` — volume `/data/minio`, no published port (Caddy fronts it)
- `web` — your image, `next start`, `depends_on` postgres healthy
- `worker` — same image, `node dist/worker.js`

All secrets in a `.env` file next to the compose file, `chmod 600`, **never committed**.
`restart: unless-stopped` on everything so a VM reboot brings the stack back.

### 5. Build for ARM
Oracle's free tier is arm64. Either build on the VM directly (simplest, 4 cores handles it), or
build locally with `docker buildx build --platform linux/arm64` and push to GHCR. Base images must
have arm64 variants — Postgres, MinIO, Caddy, and `node:20-slim` all do; `libreoffice-core` is in
Ubuntu's arm64 repos. Verify LibreOffice conversion actually runs on ARM early — don't discover it
at the end.

### 6. First run
```
docker compose --env-file .env -f docker-compose.prod.yml up -d
docker compose exec web pnpm db:migrate
docker compose exec web pnpm minio:init     # creates the bucket + CORS policy
```
MinIO **needs a CORS policy** allowing `PUT` from your domain, or browser presigned uploads fail
with an opaque CORS error. This is the single most common thing to get wrong.

### 7. Operations
- **Backups:** nightly `pg_dump` to `/data/backups` + `mc mirror` of the MinIO bucket, retained 7
  days, via cron. Also enable Oracle's block-volume backup policy. An unverified backup isn't a
  backup — restore one into a scratch container once before you trust it.
- **Logs:** `json-file` driver with `max-size: 10m, max-file: 3`, or logs will eventually fill the disk.
- **Updates:** `git pull && docker compose build && docker compose up -d`, migrations first.
- **Health:** a `/api/health` route checking Postgres + MinIO reachability, hit by an external uptime
  monitor.

### Appendix — the same stack on AWS
Ports and compose file are unchanged; only the managed pieces move:

| Oracle | AWS equivalent |
|---|---|
| Ampere A1 VM | EC2 `t4g.small` (ARM; free tier is `t3.micro`, likely too small) |
| Postgres container | RDS Postgres (`db.t4g.micro`) or keep the container |
| MinIO container | S3 bucket — drop the container, change `S3_ENDPOINT` and drop the Caddy `s3` route |
| VCN Security List | Security Group |
| Block volume | EBS |

Because storage is the S3 API either way, moving to S3 means changing environment variables and
deleting a compose service — no application code changes. Free tier expires after 12 months; budget
roughly $15–25/month after that.

---

## Verification

**Local**
- `docker compose -f docker-compose.dev.yml up` then `pnpm db:migrate && pnpm dev`.
- Sign up through Clerk; confirm the webhook fired and a row exists in your local `users` table.
  If it didn't, the tunnel isn't reaching localhost — fix that before moving on.
- Upload one of each: a Markdown prompt guide, a PDF, a `.docx`, an `.xlsx`, a `.pptx`, and a `.zip`
  containing a Dockerfile. Watch each go `pending → processing → ready`.
- Search `docker` — the zip (matched via its *inner* Dockerfile text) and every doc mentioning
  Docker return with snippets. Try `"multi stage"` and `docker -compose` to confirm
  `websearch_to_tsquery` semantics, and `dcoker` to confirm trigram fallback.
- Open each doc: Markdown renders with highlighted code, PDF paginates, docx/xlsx/pptx render, zip
  tree expands and a file inside it opens.
- Sign in as a second user: their search returns none of user 1's private docs. Flip one to
  `public`, confirm it appears and that `/p/[id]` opens **in a logged-out incognito window**.
- `EXPLAIN ANALYZE` the search query — confirm the GIN index is used, not a seq scan.

**Production**
- `https://loredex.yourdomain.com` serves a valid certificate; `http://` redirects to it.
- Clerk sign-in works with `pk_live_` keys and the webhook creates the user row on the server.
- Upload a >50 MB file — confirm from browser devtools that the `PUT` goes to `s3.yourdomain.com`,
  not through the app.
- `docker compose restart` — the stack returns and existing sessions still work.
- Reboot the VM — everything comes back unattended.
- Restore last night's `pg_dump` into a scratch container and confirm the row count matches.
