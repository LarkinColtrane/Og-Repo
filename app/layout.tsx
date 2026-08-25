import type { Metadata } from "next";
import "./globals.css";
import { copy } from "@/lib/i18n";
import { getRepository } from "@/lib/data";
import { THEME_INIT_SCRIPT } from "@/lib/hooks/use-theme";
import { NeighbourhoodProvider } from "@/components/providers/neighbourhood-provider";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";

export const metadata: Metadata = {
  title: {
    default: `${copy.brand.name} — ${copy.brand.tagline}`,
    template: `%s · ${copy.brand.shortName}`,
  },
  description: copy.brand.description,
};

/** The neighbourhood the app opens on before a visitor has chosen one. */
const DEFAULT_NEIGHBOURHOOD = "plateau-mont-royal";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Fetched once on the server and handed to the provider, so every page has the
  // neighbourhood list without each of them fetching it again.
  const neighbourhoods = await getRepository().listNeighbourhoods();
  const defaultSlug =
    neighbourhoods.find((entry) => entry.slug === DEFAULT_NEIGHBOURHOOD)?.slug ??
    neighbourhoods[0]?.slug ??
    "";

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint. Without it a dark-mode
            visitor sees a white flash on every navigation. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-ink focus:shadow-raised"
        >
          Skip to content
        </a>
        <NeighbourhoodProvider
          neighbourhoods={neighbourhoods}
          defaultSlug={defaultSlug}
        >
          <SiteHeader />
          <main id="main" className="pb-4">
            {children}
          </main>
          <SiteFooter />
        </NeighbourhoodProvider>
      </body>
    </html>
  );
}
