import { ReactNode } from 'react';

// Phone-width column + shared "page kit" styling (see mobile.css, scoped to .m-page).
// Rendered inside AppShell, which supplies the sidebar (Desktop View) or the
// bottom tab bar (Mobile View).
export default function MobileLayout({ children }: { children: ReactNode }) {
  return <div className="m-page">{children}</div>;
}
