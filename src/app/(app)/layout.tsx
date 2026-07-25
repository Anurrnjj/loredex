import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { ensureLocalUser } from "@/lib/auth";

/**
 * Every signed-in surface lives under this route group.
 *
 * `ensureLocalUser` is the safety net for the Clerk webhook: webhooks can be
 * delayed, dropped, or simply not configured yet in development, and a missing
 * `users` row breaks the foreign key on the very first upload.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const userId = await ensureLocalUser();
  if (!userId) redirect("/sign-in");

  return <AppShell>{children}</AppShell>;
}
