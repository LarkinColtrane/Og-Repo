"use client";

import { useId, useState } from "react";

/**
 * A small "what does this measure?" affordance.
 *
 * Built as a real button with `aria-describedby` rather than a `title` attribute:
 * `title` is invisible to keyboard users and to touch devices, and a metric
 * definition is content, not decoration. The panel opens on hover, on focus and on
 * click, so pointer, keyboard and touch all reach it.
 */
export function InfoHint({ label, text }: { label: string; text: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={`About ${label}`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-line-strong text-[0.625rem] font-semibold text-ink-muted transition-colors hover:border-accent hover:text-accent"
      >
        <span aria-hidden="true">i</span>
      </button>

      {open ? (
        <span
          id={id}
          role="tooltip"
          className="absolute top-6 right-0 z-20 w-56 rounded-md border border-line bg-surface p-3 text-[0.75rem] leading-relaxed font-normal text-ink-secondary shadow-raised"
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}
