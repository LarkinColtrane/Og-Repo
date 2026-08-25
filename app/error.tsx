"use client";

import { useEffect } from "react";
import { copy } from "@/lib/i18n";
import { Container } from "@/components/ui/section";
import { Button, ButtonLink } from "@/components/ui/button";

/**
 * Route-level error boundary. Catches a render or data failure in any page and
 * offers a way out, instead of leaving a blank screen.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // In production this is where a reporter (Sentry, etc.) would be called.
    console.error("[app] route error", error);
  }, [error]);

  return (
    <Container className="py-24">
      <div className="mx-auto max-w-lg text-center">
        <p className="eyebrow">Error</p>
        <h1 className="mt-3 text-[1.75rem] font-semibold tracking-[-0.025em] text-ink">
          {copy.states.error}
        </h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-secondary">
          Something failed while building this page. Retrying often clears it; if it
          does not, the details are in the browser console.
        </p>
        {error.digest ? (
          <p className="mt-2 text-[0.75rem] text-ink-muted">
            Reference: <span className="tabular">{error.digest}</span>
          </p>
        ) : null}
        <div className="mt-6 flex justify-center gap-3">
          <Button variant="primary" onClick={reset}>
            {copy.actions.retry}
          </Button>
          <ButtonLink href="/" variant="secondary">
            {copy.nav.overview}
          </ButtonLink>
        </div>
      </div>
    </Container>
  );
}
