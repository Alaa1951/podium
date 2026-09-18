"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useIsMobile } from "@/components/app/use-mobile";
import { confirmUnsaved } from "@/components/app/mobile-runtime";
import { useSession } from "next-auth/react";

import { useLocale } from "@/components/i18n/locale-provider";
import { markNotificationsRead } from "@/lib/actions/notifications";
import type { NotificationFeed, NotificationSummary } from "@/lib/notifications";
import { NOTIFICATIONS_CHANGED } from "@/components/app/notification-events";

/** Public results stay account-free; signed-in viewers get their own inbox. */
export function NotificationBell() {
  const { data: session, status } = useSession();
  if (status !== "authenticated" || !session?.user?.id) return null;
  return <NotificationInbox key={session.user.id} />;
}

function NotificationInbox() {
  const { t, locale } = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const mobile = useIsMobile();
  const [feed, setFeed] = useState<NotificationFeed | null>(null);
  const [summary, setSummary] = useState<NotificationSummary | null>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === pathname;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const summaryRequest = useRef<AbortController | null>(null);
  const summaryQueued = useRef(false);
  const lastSummaryAt = useRef(0);

  const refreshSummary = useCallback(async function refresh(force = false) {
    if (force) lastSummaryAt.current = 0;
    if (document.visibilityState !== "visible") return;
    if (summaryRequest.current) {
      // A read/send confirmed during an older request needs one fresh count
      // afterward. Focus + visibility events can share the ongoing request.
      if (force) summaryQueued.current = true;
      return;
    }
    if (!force && Date.now() - lastSummaryAt.current < 5000) return;
    const controller = new AbortController();
    summaryRequest.current = controller;
    lastSummaryAt.current = Date.now();
    try {
      const response = await fetch("/api/notifications?summary=1", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) { setSummary(null); setFeed(null); }
        return;
      }
      const next: NotificationSummary = await response.json();
      if (controller.signal.aborted) return;
      setSummary(next);
      setFeed(previous => previous && previous.scopeKey !== next.scopeKey ? null : previous);
    } catch { /* The next visible poll retries; never replace a count with a guessed value. */ }
    finally {
      summaryRequest.current = null;
      if (!controller.signal.aborted && summaryQueued.current) {
        summaryQueued.current = false;
        void refresh(true);
      }
    }
  }, []);

  const load = useCallback(async (cursor?: string) => {
    // A feed read returns its own current count. Discard an older badge poll
    // so it cannot overwrite the count confirmed after marking items read.
    summaryQueued.current = false;
    summaryRequest.current?.abort();
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const response = await fetch(`/api/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
      if (!response.ok) {
        // Drop previously loaded content after an account has been disabled.
        if (response.status === 401 || response.status === 403) { setFeed(null); setSummary(null); }
        throw new Error("INBOX_FAILED");
      }
      const next: NotificationFeed = await response.json();
      if (controller.signal.aborted) return;
      setSummary({ unreadCount: next.unreadCount, readOnly: next.readOnly, scopeKey: next.scopeKey });
      setFeed((previous) => cursor && previous && previous.scopeKey === next.scopeKey ? { ...next, items: [...previous.items, ...next.items.filter((item) => !previous.items.some((old) => old.id === item.id))] } : next);
      setError(false);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // One visible refresh cadence across sibling routes. Navigation must not
    // download twenty full messages just to display the bell's unread badge.
    const initial = window.setTimeout(() => void refreshSummary(), 0);
    const refresh = () => { void refreshSummary(); };
    const changed = () => { void refreshSummary(true); };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener(NOTIFICATIONS_CHANGED, changed);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(initial);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener(NOTIFICATIONS_CHANGED, changed);
      summaryQueued.current = false;
      summaryRequest.current?.abort();
      request.current?.abort();
    };
  }, [refreshSummary]);

  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      const timer = window.setTimeout(() => void load(), 0);
      return () => { window.clearTimeout(timer); request.current?.abort(); };
    }
    else dialog.current?.close();
  }, [open, load]);

  function markRead(ids: string[]) {
    startTransition(async () => {
      try {
        for (let offset = 0; offset < ids.length; offset += 100) {
          const result = await markNotificationsRead(ids.slice(offset, offset + 100));
          if (!result.ok) { setError(true); return; }
        }
        await load();
      } catch { setError(true); }
    });
  }

  const unread = summary?.unreadCount ?? 0;
  const shownUnread = feed?.items.filter((item) => !item.read).map((item) => item.id) ?? [];

  return (
    <>
      <button type="button" className="notification-bell btn btn-ghost" aria-label={t("Notifications, {count} unread", { count: unread })} aria-haspopup={mobile ? undefined : "dialog"} aria-expanded={mobile ? undefined : open} onClick={() => {
        if (!mobile) { setFeed(null); setOpenPath(pathname); return; }
        if (confirmUnsaved(t("You have unsaved changes. Leave this screen?"))) router.push("/notifications");
      }}>
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" /><path d="M10 21h4" /></svg>
        {unread > 0 ? <span className="notification-count pd-num" aria-hidden="true">{unread > 99 ? "99+" : unread}</span> : null}
      </button>
      <dialog ref={dialog} className="notification-dialog" aria-labelledby="notification-title" onClose={() => setOpenPath(null)} onClick={(event) => { if (event.target === event.currentTarget) setOpenPath(null); }}>
        <div className="notification-dialog-head">
          <h2 id="notification-title">{t("Notifications")}</h2>
          <button type="button" className="btn btn-ghost btn-sm" data-mobile-dismiss={open || undefined} onClick={() => setOpenPath(null)}>{t("Close")}</button>
        </div>
        <div className="notification-toolbar">
          <span aria-live="polite">{t("{count} unread", { count: unread })}</span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={pending || loading || !shownUnread.length || feed?.readOnly} onClick={() => markRead(shownUnread)}>{t("Mark shown as read")}</button>
        </div>
        {feed?.readOnly ? <p className="notice">{t("Preview is read-only.")}</p> : null}
        {error ? <div className="notice" role="alert">{t("Could not update notifications.")} <button type="button" className="btn btn-ghost btn-sm" disabled={loading} onClick={() => void load()}>{t("Try again")}</button></div> : null}
        {loading ? <p role="status">{t("Loading")}</p> : null}
        {feed?.items.length === 0 && !loading ? <p>{t("No announcements yet.")}</p> : null}
        <ul className="notification-list">
          {feed?.items.map((item) => (
            <li key={item.id} className="notification-item" data-unread={!item.read || undefined}>
              <h3 dir="auto">{item.title}</h3>
              <time dateTime={item.createdAt}>{new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</time>
              <p dir="auto">{item.body}</p>
              {!item.read ? <button type="button" className="btn btn-ghost btn-sm" disabled={pending || feed.readOnly} onClick={() => markRead([item.id])}>{t("Mark as read")}</button> : <span className="muted">{t("Read")}</span>}
            </li>
          ))}
        </ul>
        {feed?.nextCursor ? <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void load(feed.nextCursor ?? undefined)}>{t("Load more")}</button> : null}
      </dialog>
    </>
  );
}
