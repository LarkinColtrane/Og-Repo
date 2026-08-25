"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { copy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { NeighbourhoodSelector } from "./neighbourhood-selector";
import { ThemeToggle } from "./theme-toggle";

const NAV_ITEMS = [
  { href: "/", label: copy.nav.overview },
  { href: "/rent", label: copy.nav.rent },
  { href: "/buy", label: copy.nav.buy },
  { href: "/sell", label: copy.nav.sell },
  { href: "/invest", label: copy.nav.invest },
  { href: "/neighbourhoods", label: copy.nav.neighbourhoods },
  { href: "/compare", label: copy.nav.compare },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPath, setMenuPath] = useState(pathname);

  // A tap that navigates should also dismiss the menu it was tapped in. Adjusting
  // state during render when a prop changes is React's documented alternative to a
  // synchronising effect: it happens before anything is painted, so the open menu
  // is never briefly visible on the new page.
  if (pathname !== menuPath) {
    setMenuPath(pathname);
    setMenuOpen(false);
  }

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-page/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5"
          aria-label={copy.brand.name}
        >
          <Mark />
          <span className="hidden text-[0.9375rem] font-semibold tracking-[-0.015em] text-ink sm:inline">
            {copy.brand.shortName}
          </span>
        </Link>

        <nav
          aria-label="Primary"
          className="ml-2 hidden flex-1 items-center gap-0.5 lg:flex"
        >
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              active={isActive(pathname, item.href)}
            />
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden md:block">
            <NeighbourhoodSelector size="sm" hideLabel />
          </div>
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-ink-secondary transition-colors hover:border-accent hover:text-accent lg:hidden"
          >
            <span className="sr-only">
              {menuOpen ? copy.nav.closeMenu : copy.nav.menu}
            </span>
            <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
              {menuOpen ? (
                <path
                  d="M3.5 3.5l9 9M12.5 3.5l-9 9"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d="M2 4h12M2 8h12M2 12h12"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
        </div>
      </div>

      {menuOpen ? (
        <div id="mobile-nav" className="border-t border-line bg-surface lg:hidden">
          <div className="mx-auto w-full max-w-[1200px] px-4 py-4 sm:px-6">
            <div className="mb-4 md:hidden">
              <NeighbourhoodSelector />
            </div>
            <nav aria-label="Primary" className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  active={isActive(pathname, item.href)}
                  block
                />
              ))}
            </nav>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function NavLink({
  href,
  label,
  active,
  block = false,
}: {
  href: string;
  label: string;
  active: boolean;
  block?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-md px-3 py-1.5 text-[0.875rem] font-medium transition-colors",
        block && "block",
        active
          ? "bg-accent-soft text-accent"
          : "text-ink-secondary hover:bg-surface-inset hover:text-ink",
      )}
    >
      {label}
    </Link>
  );
}

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** A restrained wordmark: an abstract skyline rather than a house icon. */
function Mark() {
  return (
    <span
      aria-hidden="true"
      className="flex h-7 w-7 items-center justify-center rounded-[5px] bg-accent text-accent-ink"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path
          d="M2.5 12.5V7.5M6 12.5V4M9.5 12.5V9M13 12.5V6"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
