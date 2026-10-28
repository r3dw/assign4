import { ICONS } from "@/lib/icons";

/** A decorative stroke icon, hidden from assistive technology. */
export function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className || undefined}
      // Trusted, static markup from src/lib/icons.ts.
      dangerouslySetInnerHTML={{ __html: ICONS[name] || "" }}
    />
  );
}
