"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";

import { useLocale } from "@/components/i18n/locale-provider";
import { markNotificationsRead } from "@/lib/actions/notifications";
import type { NotificationFeed } from "@/lib/notifications";

/** Public results stay account-free; signed-in viewers get their own inbox. */
export function NotificationBell() {
  const { data: session, status } = useSession();
  if (status !== "authenticated" || !session?.user?.id) return null;
  return <NotificationInbox key={session.user.id} />;
}

function NotificationInbox() {
  const { t, locale } = useLocale();
  const pathname = usePathname();
  const [feed, setFeed] = useState<NotificationFeed | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async (cursor?: string) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const response = await fetch(`/api/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
      if (!response.ok) {
        // Drop previously loaded content after an account has been disabled.
        if (response.status === 401 || response.status === 403) setFeed(null);
        throw new Error("INBOX_FAILED");
      }
      const next: NotificationFeed = await response.json();
      setFeed((previous) => cursor && previous && previous.scopeKey === next.scopeKey ? { ...next, items: [...previous.items, ...next.items.filter((item) => !previous.items.some((old) => old.id === item.id))] } : next);
      setError(false);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Refresh on navigation and resume; poll while the inbox is closed.
    const initial = window.setTimeout(() => void load(), 0);
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(() => { if (!open) refresh(); }, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(initial);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      request.current?.abort();
    };
  }, [load, pathname, open]);

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

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

  const unread = feed?.unreadCount ?? 0;
  const shownUnread = feed?.items.filter((item) => !item.read).map((item) => item.id) ?? [];

  return (
    <>
      <button type="button" className="notification-bell btn btn-ghost" aria-label={t("Notifications, {count} unread", { count: unread })} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" /><path d="M10 21h4" /></svg>
        {unread > 0 ? <span className="notification-count pd-num" aria-hidden="true">{unread > 99 ? "99+" : unread}</span> : null}
      </button>
      <dialog ref={dialog} className="notification-dialog" aria-labelledby="notification-title" onClose={() => setOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <div className="notification-dialog-head">
          <h2 id="notification-title">{t("Notifications")}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>{t("Close")}</button>
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
