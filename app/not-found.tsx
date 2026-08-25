import { copy } from "@/lib/i18n";
import { Container } from "@/components/ui/section";
import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <Container className="py-24">
      <div className="mx-auto max-w-lg text-center">
        <p className="eyebrow">404</p>
        <h1 className="mt-3 text-[1.75rem] font-semibold tracking-[-0.025em] text-ink">
          {copy.neighbourhoodsPage.notFoundTitle}
        </h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-secondary">
          {copy.neighbourhoodsPage.notFoundBody}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <ButtonLink href="/neighbourhoods" variant="primary">
            {copy.actions.viewAll}
          </ButtonLink>
          <ButtonLink href="/" variant="secondary">
            {copy.nav.overview}
          </ButtonLink>
        </div>
      </div>
    </Container>
  );
}
