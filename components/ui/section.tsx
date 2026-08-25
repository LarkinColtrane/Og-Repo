import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Consistent page gutter and maximum measure across every route. */
export function Container({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-[1200px] px-4 sm:px-6 lg:px-8", className)}>
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Badges or provenance shown under the title. */
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("border-b border-line pb-6", className)}>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
          <h1 className="text-[1.75rem] leading-[1.15] font-semibold tracking-[-0.025em] text-ink sm:text-[2.125rem]">
            {title}
          </h1>
          {description ? (
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-secondary">
              {description}
            </p>
          ) : null}
          {meta ? <div className="mt-4 flex flex-wrap gap-2">{meta}</div> : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
    </header>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-24", className)}>
      {title ? (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-[1.125rem] font-semibold tracking-[-0.015em] text-ink">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 max-w-2xl text-[0.8125rem] leading-relaxed text-ink-secondary">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Vertical rhythm between the major blocks of a page. */
export function Stack({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("space-y-8 sm:space-y-10", className)}>{children}</div>;
}
