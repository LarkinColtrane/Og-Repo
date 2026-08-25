import Link from "next/link";
import { copy } from "@/lib/i18n";
import { Container } from "@/components/ui/section";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line bg-surface">
      <Container className="py-10">
        <div className="flex flex-col gap-8 md:flex-row md:justify-between">
          <div className="max-w-md">
            <p className="text-[0.9375rem] font-semibold tracking-[-0.015em] text-ink">
              {copy.brand.name}
            </p>
            <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-secondary">
              {copy.footer.dataNote}
            </p>
            <p className="mt-2 text-[0.75rem] text-ink-muted">{copy.footer.builtWith}</p>
          </div>

          <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-3">
            <FooterColumn
              title={copy.nav.overview}
              links={[
                { href: "/rent", label: copy.nav.rent },
                { href: "/buy", label: copy.nav.buy },
                { href: "/sell", label: copy.nav.sell },
                { href: "/invest", label: copy.nav.invest },
              ]}
            />
            <FooterColumn
              title={copy.nav.neighbourhoods}
              links={[
                { href: "/neighbourhoods", label: copy.actions.viewAll },
                { href: "/compare", label: copy.nav.compare },
                { href: "/property-analyzer", label: copy.analyzer.title },
              ]}
            />
            <FooterColumn
              title={copy.footer.sourcesLink}
              links={[{ href: "/data-sources", label: copy.dataPage.title }]}
            />
          </nav>
        </div>
      </Container>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: Array<{ href: string; label: string }>;
}) {
  return (
    <div>
      <p className="eyebrow mb-2.5">{title}</p>
      <ul className="space-y-1.5">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="text-[0.8125rem] text-ink-secondary transition-colors hover:text-accent"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
