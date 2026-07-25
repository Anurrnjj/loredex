import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Next.js 16 renamed `middleware.ts` to `proxy.ts`. The functionality is
 * unchanged — Clerk still ships `clerkMiddleware`, and it is mounted here.
 *
 * This is an optimistic gate for a better UX (unauthenticated users get bounced
 * to sign-in rather than seeing an empty page). It is NOT the authorization
 * boundary: every route and query independently enforces access via
 * `requireUser()` and the helpers in `src/lib/access.ts`.
 */

/** Reachable without signing in. Everything else requires a session. */
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/p/(.*)", // shared read-only document pages
  "/api/webhooks/(.*)", // Clerk posts here with no session
  "/api/health",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Everything except Next internals and static assets, unless it carries
    // a search param (so a link into a static-looking path still runs auth).
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
