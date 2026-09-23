"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Logo } from "./Logo";

const LINKS = [
  { href: "/dashboard", label: "Library" },
  { href: "/create", label: "Create" },
  { href: "/billing", label: "Billing" },
];

export function AppNav({ email, pro, used, limit }: { email: string; pro: boolean; used: number; limit: number }) {
  const path = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-zinc-950/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Logo href="/dashboard" />
        <nav className="ml-2 flex items-center gap-1 sm:ml-6">
          {LINKS.map((l) => {
            const active = path === l.href || path.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  active ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {pro ? (
            <span className="rounded-full bg-gradient-to-r from-brand-600 to-accent-500 px-2.5 py-1 text-xs font-bold">PRO</span>
          ) : (
            <Link
              href="/billing"
              className="hidden rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-300 hover:border-brand-500 sm:block"
              title="Videos created this month"
            >
              {used}/{limit} free videos · <span className="text-brand-400">Upgrade</span>
            </Link>
          )}
          <span className="hidden text-sm text-zinc-500 lg:block">{email}</span>
          <button onClick={logout} className="text-sm text-zinc-400 hover:text-white">
            Log out
          </button>
        </div>
      </div>
    </header>
  );
}
