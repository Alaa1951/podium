import Link from "next/link";

import { PoweredBy, PublicBrand } from "@/components/board/board-brand";

/**
 * THE PUBLISHED RESULTS.
 *
 * Its own ground, its own chrome, and no console around it: this is the page a
 * competitor opens on their phone on the bus home, and the only thing on it is
 * the result. The wordmark is the whole header, the way BFT's own board does
 * it, and the back link is the only navigation there is.
 */
export function PublicShell({
  back,
  children,
}: {
  /** Where "back" goes, and what it is called. Omitted on the first screen. */
  back?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <div className="public">
      <header className="public-head">
        {back ? (
          <Link href={back.href} className="public-back">
            ‹ {back.label}
          </Link>
        ) : (
          <span />
        )}

        <Link href="/results" className="public-mark" aria-label="PODIUM">
          <PublicBrand />
        </Link>

        <span />
      </header>

      <main className="public-main">{children}</main>

      <footer className="public-foot">
        <PoweredBy tone="dark" label="POWERED BY BFT MENA" />
        {/* Both stores require a reachable privacy policy; keep it one tap
            away from every public screen, in both languages at once. */}
        <Link href="/privacy" className="public-privacy">
          PRIVACY · الخصوصية
        </Link>
      </footer>
    </div>
  );
}
