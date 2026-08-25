import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The surface every panel on the platform sits on: a hairline border, a barely
 * perceptible shadow, restrained radius. Cards do the separating so the content
 * inside them does not need heavy rules or background fills.
 */
export function Card({
  children,
  className,
  as: Component = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
}) {
  return (
    <Component
      className={cn(
        "rounded-md border border-line bg-surface shadow-card",
        "transition-colors duration-200",
        className,
      )}
    >
      {children}
    </Component>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-b border-line px-5 py-4",
        "sm:flex-row sm:items-start sm:justify-between sm:gap-6",
        className,
      )}
    >
      <div className="min-w-0">
        <h3 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink">
          {title}
        </h3>
        {description ? (
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-secondary">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="min-w-0 max-w-full shrink-0">{actions}</div> : null}
    </div>
  );
}

export function CardBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("px-5 py-4", className)}>{children}</div>;
}

export function CardFooter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border-t border-line px-5 py-3", className)}>{children}</div>
  );
}
