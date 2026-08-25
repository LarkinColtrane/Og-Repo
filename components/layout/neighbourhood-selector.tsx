"use client";

import { useRouter } from "next/navigation";
import { copy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/select";
import { useNeighbourhoods } from "@/components/providers/neighbourhood-provider";

/**
 * The prominent "Explore: [ … ]" control.
 *
 * `navigateOnChange` distinguishes the two jobs it does. In the header it changes
 * the shared selection, which every dashboard reads. On the neighbourhoods index
 * it navigates, because there the URL is what identifies the area being viewed.
 */
export function NeighbourhoodSelector({
  size = "md",
  navigateOnChange = false,
  className,
  hideLabel = false,
}: {
  size?: "sm" | "md";
  navigateOnChange?: boolean;
  className?: string;
  hideLabel?: boolean;
}) {
  const { neighbourhoods, selectedSlug, setSelectedSlug } = useNeighbourhoods();
  const router = useRouter();

  return (
    <Select
      label={copy.selector.label}
      hideLabel={hideLabel}
      size={size}
      className={cn("min-w-[13rem]", className)}
      value={selectedSlug}
      onChange={(slug) => {
        setSelectedSlug(slug);
        if (navigateOnChange) router.push(`/neighbourhoods/${slug}`);
      }}
      options={neighbourhoods.map((entry) => ({
        value: entry.slug,
        label: entry.name,
      }))}
    />
  );
}
