import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";

/** The Clerk user ID for this request, or null when signed out. */
export async function getUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId ?? null;
}

/**
 * Asserts a signed-in user and returns their ID.
 *
 * Throws rather than redirecting so it is safe in route handlers as well as
 * server components; callers that want a redirect should check `getUserId()`.
 */
export async function requireUserId(): Promise<string> {
  const userId = await getUserId();
  if (!userId) throw new UnauthorizedError();
  return userId;
}

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("Not signed in");
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "Not allowed") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Ensures a local `users` row exists for the signed-in Clerk user.
 *
 * The webhook is the primary sync path, but webhooks can be delayed, dropped,
 * or simply not configured yet in development — and a missing row breaks the
 * foreign key on the first upload. This is the safety net, called from the
 * authenticated layout.
 */
export async function ensureLocalUser(): Promise<string | null> {
  const userId = await getUserId();
  if (!userId) return null;

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (existing.length > 0) return userId;

  const clerkUser = await currentUser();
  await db
    .insert(users)
    .values({
      id: userId,
      email: clerkUser?.primaryEmailAddress?.emailAddress ?? null,
      displayName:
        clerkUser?.fullName ??
        clerkUser?.username ??
        clerkUser?.primaryEmailAddress?.emailAddress ??
        null,
      avatarUrl: clerkUser?.imageUrl ?? null,
    })
    .onConflictDoNothing();

  return userId;
}
