import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";

/**
 * Keeps the local `users` table in sync with Clerk.
 *
 * Clerk owns identity; this table exists so `documents.owner_id` has something
 * to join against for "uploaded by", and so a deleted Clerk account cascades
 * to their documents.
 *
 * `verifyWebhook` checks the Svix signature against
 * CLERK_WEBHOOK_SIGNING_SECRET. Unverified payloads are rejected — this
 * endpoint is public (no session), so the signature *is* the authentication.
 *
 * Configure at Clerk dashboard → Webhooks → add endpoint
 * `<your-url>/api/webhooks/clerk`, subscribed to user.created, user.updated,
 * and user.deleted. The signing secret differs between dev and production.
 */
export async function POST(req: NextRequest) {
  let event;
  try {
    event = await verifyWebhook(req);
  } catch (err) {
    console.error("[clerk-webhook] signature verification failed:", err);
    return new Response("Invalid signature", { status: 400 });
  }

  switch (event.type) {
    case "user.created":
    case "user.updated": {
      const data = event.data;
      const primaryEmail =
        data.email_addresses?.find(
          (e) => e.id === data.primary_email_address_id,
        )?.email_address ??
        data.email_addresses?.[0]?.email_address ??
        null;

      const displayName =
        [data.first_name, data.last_name].filter(Boolean).join(" ") ||
        data.username ||
        primaryEmail;

      await db
        .insert(users)
        .values({
          id: data.id,
          email: primaryEmail,
          displayName,
          avatarUrl: data.image_url ?? null,
        })
        .onConflictDoUpdate({
          target: users.id,
          set: {
            email: primaryEmail,
            displayName,
            avatarUrl: data.image_url ?? null,
            updatedAt: new Date(),
          },
        });
      break;
    }

    case "user.deleted": {
      // Cascades to collections, documents, content, tags, and jobs.
      // The storage objects are cleaned up separately by the purge job.
      if (event.data.id) {
        await db.delete(users).where(eq(users.id, event.data.id));
      }
      break;
    }

    default:
      // Unsubscribed event types are acknowledged, not errored — otherwise
      // Clerk retries them forever.
      break;
  }

  return new Response("ok", { status: 200 });
}
