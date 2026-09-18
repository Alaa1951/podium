import Link from "next/link";

import { PoweredBy, PublicBrand } from "@/components/board/board-brand";
import { NotificationBell } from "@/components/app/notification-bell";
import { PersonalMobileNavigation } from "@/components/app/mobile-navigation";
import { homeForUser, getCurrentUser } from "@/lib/session";

/**
 * THE PUBLISHED RESULTS.
 *
 * Its own ground, its own chrome, and no console around it: this is the page a
 * competitor opens on their phone on the bus home, and the only thing on it is
 * the result. The wordmark is the whole header, the way BFT's own board does
 * it, and the back link is the only navigation there is.
 */
export async function PublicShell({
  back,
  children,
}: {
  /** Where "back" goes, and what it is called. Omitted on the first screen. */
  back?: { href: string; label: string };
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
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

        <div className="public-inbox"><NotificationBell /></div>
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
      {user ? <PersonalMobileNavigation role={user.role} homeHref={await homeForUser(user)} /> : null}
    </div>
  );
}
