import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

config({ path: ".env.local" });
config({ path: ".env" });

/**
 * Runs pending migrations from ./drizzle. Uses a dedicated single connection
 * (`max: 1`) — migrations must not interleave across pooled connections.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const client = postgres(url, { max: 1 });
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  await client.end();
  console.log("migrations applied");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("migration failed:", err);
    process.exit(1);
  },
);
