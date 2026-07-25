import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { Library, Upload, FolderOpen, Search } from "lucide-react";

/**
 * The persistent chrome: a thin top bar and nothing else. Deliberately sparse —
 * the documents are the interest, and every pixel of navigation is a pixel not
 * spent on content.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-4 sm:px-6">
          <Link
            href="/"
            className="mr-3 flex items-center gap-2 rounded-md px-1 py-1 text-sm font-semibold tracking-tight"
          >
            <Library className="size-4 text-accent" aria-hidden />
            Loredex
          </Link>

          <NavLink href="/search" icon={<Search className="size-4" />}>
            Search
          </NavLink>
          <NavLink href="/collections" icon={<FolderOpen className="size-4" />}>
            Collections
          </NavLink>

          <div className="ml-auto flex items-center gap-3">
            <Link
              href="/upload"
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
            >
              <Upload className="size-3.5" aria-hidden />
              Upload
            </Link>
            <UserButton
              appearance={{ elements: { avatarBox: "size-7" } }}
            />
          </div>
        </div>
      </header>

      <div className="flex-1">{children}</div>
    </>
  );
}

function NavLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="hidden items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg sm:inline-flex"
    >
      {icon}
      {children}
    </Link>
  );
}
