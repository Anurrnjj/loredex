import { HeadBucketCommand } from "@aws-sdk/client-s3";

import { sql } from "@/db";
import { bucket, getS3 } from "@/lib/s3";

export const dynamic = "force-dynamic";

/**
 * Liveness + dependency check for an external uptime monitor.
 * Returns 503 if either dependency is unreachable, so a silent Postgres or
 * MinIO outage pages you instead of surfacing as confusing 500s later.
 */
export async function GET() {
  const checks: Record<string, "ok" | string> = {};

  try {
    await sql`select 1`;
    checks.database = "ok";
  } catch (err) {
    checks.database = err instanceof Error ? err.message : "unreachable";
  }

  try {
    await getS3().send(new HeadBucketCommand({ Bucket: bucket() }));
    checks.storage = "ok";
  } catch (err) {
    checks.storage = err instanceof Error ? err.message : "unreachable";
  }

  const healthy = Object.values(checks).every((v) => v === "ok");
  return Response.json(
    { status: healthy ? "ok" : "degraded", checks },
    { status: healthy ? 200 : 503 },
  );
}
