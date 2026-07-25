import { SignIn } from "@clerk/nextjs";
import { Library } from "lucide-react";

export const metadata = { title: "Sign in" };

/**
 * The `[[...sign-in]]` optional catch-all segment is required by Clerk — it
 * routes the multi-step flows (verification, MFA, SSO callback) that all live
 * under this path.
 */
export default function SignInPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6 py-16">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex size-11 items-center justify-center rounded-xl bg-accent-subtle text-accent">
          <Library className="size-5" aria-hidden />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Loredex</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Your accumulated project lore, indexed and searchable.
          </p>
        </div>
      </div>
      <SignIn />
    </main>
  );
}
