import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { documents } from "@/db/schema";
import { UnauthorizedError, requireUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Polled by the upload page while the worker extracts, so the status pill
 * reflects reality rather than an optimistic guess.
 *
 * Scoped to the caller's own documents — status leaks which IDs exist.
 */
export async function GET(req: Request) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return Response.json({ error: "Not signed in" }, { status: 401 });
    }
    throw err;
  }

  const ids = (new URL(req.url).searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);

  if (ids.length === 0) return Response.json({ documents: [] });

  const rows = await db
    .select({
      id: documents.id,
      status: documents.status,
      failureReason: documents.failureReason,
    })
    .from(documents)
    .where(and(inArray(documents.id, ids), eq(documents.ownerId, userId)));

  return Response.json({ documents: rows });
}
