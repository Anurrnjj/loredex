# syntax=docker/dockerfile:1
#
# One image, two roles: the web server (`node server.js`) and the extraction
# worker (`node worker.js`). They share all the same code and dependencies, so
# building them separately would only duplicate ~700 MB.
#
# Oracle's Always Free tier is arm64 (Ampere A1). Every base image used here
# has an arm64 variant, and `libreoffice-*` is in Debian's arm64 repos. Build
# on the VM itself, or locally with:
#   docker buildx build --platform linux/arm64 -t loredex .

# --- deps -------------------------------------------------------------------
FROM node:20-slim AS deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

# --- prod-deps --------------------------------------------------------------
# The worker bundle deliberately leaves a few packages external (pdf.js loads
# its own assets at runtime and does not survive bundling). Those need to exist
# as real directories in the runtime image — and pnpm's default node_modules is
# a tree of symlinks into .pnpm, which does not survive a COPY. The hoisted
# linker produces a plain, self-contained node_modules instead.
FROM node:20-slim AS prod-deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --prod --node-linker=hoisted

# --- build ------------------------------------------------------------------
FROM node:20-slim AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next inlines NEXT_PUBLIC_* at build time, so Clerk's publishable key must be
# present now — not at runtime. Passed via --build-arg in compose.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_TELEMETRY_DISABLED=1

RUN pnpm build

# The worker and the migration runner are plain TypeScript rather than part of
# the Next build, so they are bundled separately. This is what lets the runtime
# image carry neither pnpm nor tsx.
RUN pnpm exec esbuild src/worker/index.ts \
      --bundle --platform=node --target=node20 --format=cjs \
      --outfile=worker.js \
      --external:pdfjs-dist --external:mammoth --external:xlsx --external:yauzl \
      --external:postgres \
 && pnpm exec esbuild scripts/migrate.ts \
      --bundle --platform=node --target=node20 --format=cjs \
      --outfile=migrate.js \
      --external:postgres \
 && pnpm exec esbuild scripts/init-storage.ts \
      --bundle --platform=node --target=node20 --format=cjs \
      --outfile=init-storage.js

# --- runtime ----------------------------------------------------------------
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOME=/home/app

# LibreOffice is required only for .pptx and the legacy binary Office formats
# (.doc/.xls/.ppt) — .docx and .xlsx are handled in pure JS. It is also the
# single reason this app is containerised rather than deployed serverless.
# `--no-install-recommends` plus the -core/-writer/-calc/-impress split keeps
# this to roughly a third of the full libreoffice metapackage.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-core \
      libreoffice-writer \
      libreoffice-calc \
      libreoffice-impress \
      fonts-liberation \
      fonts-dejavu-core \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --home /home/app --create-home app

# Next's standalone output bundles only the server and the modules it actually
# uses; static assets are copied alongside it.
COPY --from=build --chown=app:nodejs /app/.next/standalone ./
COPY --from=build --chown=app:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=app:nodejs /app/public ./public

# The worker and one-shot scripts live in their own directory with their own
# node_modules, deliberately kept apart from the standalone server's.
#
# Node resolves modules relative to the *importing file*, so /app/jobs/worker.js
# finds /app/jobs/node_modules without NODE_PATH — which matters because the
# PDF extractor uses a dynamic import(), and dynamic import ignores NODE_PATH.
# Merging the two trees instead fails outright: Next's traced output stores
# some packages as symlinks, and a directory cannot be copied over one.
COPY --from=build --chown=app:nodejs /app/worker.js ./jobs/worker.js
COPY --from=build --chown=app:nodejs /app/migrate.js ./jobs/migrate.js
COPY --from=build --chown=app:nodejs /app/init-storage.js ./jobs/init-storage.js
COPY --from=prod-deps --chown=app:nodejs /app/node_modules ./jobs/node_modules

# Migration SQL. The runner resolves ./drizzle relative to the process cwd,
# which is /app for every command in this image.
COPY --from=build --chown=app:nodejs /app/drizzle ./drizzle

USER app
EXPOSE 3000

# Overridden to `node worker.js` for the worker service.
CMD ["node", "server.js"]
