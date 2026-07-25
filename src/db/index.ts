import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * A single pooled connection reused across hot reloads. Without the global
 * cache, `next dev` opens a new pool on every recompile and exhausts
 * Postgres's connection limit within a few edits.
 */
const globalForDb = globalThis as unknown as {
  loredexSql?: ReturnType<typeof postgres>;
  loredexDb?: ReturnType<typeof drizzle<typeof schema>>;
};

/**
 * Built lazily on first query, not at import time.
 *
 * `next build` imports every route to collect metadata. Connecting (or even
 * reading DATABASE_URL) at module scope would make the build require a live
 * database and runtime secrets, which it should not.
 */
function client() {
  return (globalForDb.loredexSql ??= postgres(env().DATABASE_URL, {
    max: 10,
    // Extraction can hand us text with NUL bytes; postgres.js rejects those
    // loudly, which is what we want — the extractor sanitises instead.
    prepare: false,
  }));
}

function database() {
  return (globalForDb.loredexDb ??= drizzle(client(), { schema }));
}

/**
 * Proxies so `db` and `sql` stay ordinary-looking values at every call site
 * while the underlying connection is still created on first use.
 */
export const db = new Proxy({} as ReturnType<typeof database>, {
  get: (_, prop) => Reflect.get(database(), prop),
});

// The proxy target must itself be callable — `sql` is used as a tagged
// template (sql`select …`), so an `apply` trap on a plain object would throw.
export const sql = new Proxy(function () {} as unknown as ReturnType<
  typeof client
>, {
  get: (_, prop) => Reflect.get(client(), prop),
  apply: (_, thisArg, args) =>
    Reflect.apply(client() as never, thisArg, args as never),
}) as ReturnType<typeof client>;

export * from "./schema";
