"use client";

import { useThemePreference, type ThemePreference } from "@/lib/hooks/use-theme";
import { cn } from "@/lib/utils";

const ORDER: ThemePreference[] = ["system", "light", "dark"];

const LABELS: Record<ThemePreference, string> = {
  system: "Match system theme",
  light: "Light theme",
  dark: "Dark theme",
};

/**
 * Cycles system → light → dark. Three states rather than two, because "follow the
 * OS" is a real preference and a two-way switch silently overrides it.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [preference, setPreference] = useThemePreference();
  const next = ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length];

  return (
    <button
      type="button"
      onClick={() => setPreference(next)}
      aria-label={`${LABELS[preference]}. Switch to: ${LABELS[next]}`}
      title={LABELS[preference]}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md border border-line text-ink-secondary transition-colors hover:border-accent hover:text-accent",
        className,
      )}
    >
      <Icon preference={preference} />
    </button>
  );
}

function Icon({ preference }: { preference: ThemePreference }) {
  if (preference === "light") {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="3.25" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M8 1v1.5M8 13.5V15M15 8h-1.5M2.5 8H1M12.95 3.05l-1.06 1.06M4.11 11.89l-1.06 1.06M12.95 12.95l-1.06-1.06M4.11 4.11L3.05 3.05"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (preference === "dark") {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M13.5 9.6A5.8 5.8 0 016.4 2.5a5.8 5.8 0 107.1 7.1z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="1.5"
        y="2.75"
        width="13"
        height="9"
        rx="1.25"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path d="M5.5 14h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
