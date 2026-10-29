/** Original Shapewright mark: a chevron over three layer lines. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="7" fill="var(--sw-accent)" />
      <path d="M8 13 L16 7 L24 13" fill="none" stroke="var(--sw-accent-contrast)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 18h16M8 22h16M8 26h16" stroke="var(--sw-accent-contrast)" strokeWidth="2" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}
