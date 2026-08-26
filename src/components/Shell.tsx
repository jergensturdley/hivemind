"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Avatar, cls } from "@/components/ui";

export function Shell({ user, children }: { user: { id: number; name: string; email: string; hue: number }; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const signOut = async () => {
    await fetch("/api/auth/out", { method: "POST" });
    router.push("/");
    router.refresh();
  };

  const nav = [
    { href: "/studio", label: "Studio" },
    { href: "/settings", label: "Settings" },
  ];

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-honey focus:px-3 focus:py-2 focus:text-[13px] focus:font-bold focus:text-on-honey"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-20 flex min-h-[54px] items-center gap-2 border-b border-line bg-bg1/90 px-3 pt-[env(safe-area-inset-top)] backdrop-blur sm:gap-4 sm:px-4">
        <Link href="/studio" className="flex shrink-0 items-center gap-2 font-display text-[16px] font-bold text-ink">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-honey/15 text-[14px] text-honey">◈</span>
          <span className="hidden sm:inline">hivemind</span>
        </Link>
        <nav className="flex min-w-0 items-center gap-1">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`inline-flex min-h-11 items-center rounded-md px-2.5 text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-honey/80 focus-visible:ring-offset-2 focus-visible:ring-offset-bg1 sm:px-3 ${
                pathname.startsWith(n.href) ? "bg-bg3 text-honey" : "text-mut hover:text-ink"
              }`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <div className="hidden text-right sm:block">
            <div className="text-[12.5px] leading-tight font-bold text-ink">{user.name}</div>
            <div className="text-[10.5px] text-dim">{user.email}</div>
          </div>
          <Avatar hue={user.hue} glyph={user.name[0]?.toUpperCase() ?? "U"} size={32} />
          <button
            type="button"
            onClick={() => void signOut()}
            className={`inline-flex min-h-11 items-center rounded-md border border-line px-2.5 text-[12px] font-semibold text-mut transition hover:border-err/50 hover:text-err cursor-pointer lg:min-h-0 ${cls.focus}`}
          >
            Sign out
          </button>
        </div>
      </header>
      {children}
    </div>
  );
}
