"use client";

import { Capacitor } from "@capacitor/core";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useState } from "react";
import { useT } from "@/components/i18n/locale-provider";
import { parentRoute, safeAppPath } from "@/lib/mobile-navigation";
import { useNativeSafeArea } from "@/components/app/use-native-safe-area";

// Forms register explicitly: a refresh or failed save must never clear a draft.
const dirtyScreens = new Set<symbol>();
let approvedPop = false;
export function approveHistoryBack() { approvedPop = true; }
export function readNavigationTrail(): string[] {
  try { const value: unknown = JSON.parse(sessionStorage.getItem("podium:trail") ?? "[]"); return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && !!safeAppPath(entry)) : []; } catch { return []; }
}
export function confirmUnsaved(message: string) { return dirtyScreens.size === 0 || window.confirm(message); }
export function useUnsavedChanges(dirty: boolean) {
  useLayoutEffect(() => {
    const id = Symbol();
    if (dirty) dirtyScreens.add(id);
    return () => { dirtyScreens.delete(id); };
  }, [dirty]);
}

export function MobileRuntime() {
  useNativeSafeArea();
  const path = usePathname();
  const router = useRouter();
  const t = useT();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if(document.querySelector("[data-route-error]")) return;
    const current = safeAppPath(path + location.search);
    let trail: string[] = [];
    trail = readNavigationTrail();
    if (!current) { trail = []; sessionStorage.removeItem("podium:lastPath"); try {localStorage.removeItem("podium:lastPath");} catch {} }
    else {
      const index = trail.indexOf(current);
      trail = index >= 0 ? trail.slice(0, index + 1) : [...trail, current].slice(-40);
      sessionStorage.setItem("podium:lastPath", current);
      try { localStorage.setItem("podium:lastPath", current); } catch { /* Restricted browser storage. */ }
    }
    sessionStorage.setItem("podium:trail", JSON.stringify(trail));
    try {
      const saved = JSON.parse(sessionStorage.getItem(`podium:list:${path}`) ?? "null") as {href:string;scroll:number} | null;
      if (saved?.href === current && Number.isFinite(saved.scroll)) requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, saved.scroll)));
    } catch { /* Invalid or expired list state. */ }
    if (Capacitor.isNativePlatform()) void import("@capacitor/preferences").then(({ Preferences }) => current
      ? Preferences.set({ key: "podium:lastPath", value: current })
      : Preferences.remove({ key: "podium:lastPath" })).catch(() => {});
  }, [path]);

  useEffect(() => {
    document.documentElement.dataset.native = String(Capacitor.isNativePlatform());
    document.documentElement.dataset.nativePlatform = Capacitor.getPlatform();
    const breakpoint = matchMedia("(max-width: 900px)");
    const updateMobile = () => {document.documentElement.dataset.mobile = String(Capacitor.isNativePlatform() || breakpoint.matches);};
    updateMobile(); breakpoint.addEventListener("change", updateMobile);
    document.documentElement.dataset.mobileReady = "true";
    const updateNetwork = () => setOffline(!navigator.onLine);
    updateNetwork();
    window.addEventListener("online", updateNetwork);
    window.addEventListener("offline", updateNetwork);
    const confirmLeave = () => confirmUnsaved(t("You have unsaved changes. Leave this screen?"));
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirtyScreens.size) { event.preventDefault(); event.returnValue = ""; } };
    const click = (event: MouseEvent) => {
      const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
      if (link && link.href !== location.href && !confirmLeave()) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    let restoringHistory = false;
    const popstate = (event: PopStateEvent) => {
      if (restoringHistory) { restoringHistory = false; return; }
      if (approvedPop) { approvedPop = false; return; }
      if (!confirmLeave()) { event.stopImmediatePropagation(); restoringHistory = true; window.history.go(1); }
    };
    window.addEventListener("popstate", popstate, true);

    // Only relabel tables touched by a mutation, once per frame. Timers,
    // notification badges and loading animations must not rescan every row.
    const pendingTables = new Set<HTMLTableElement>();
    let labelFrame = 0;
    const labelTables = () => {
      labelFrame = 0;
      if (document.documentElement.dataset.mobile !== "true") { pendingTables.clear(); return; }
      pendingTables.forEach((table) => {
      if (!table.isConnected) return;
      const headings = Array.from(table.querySelectorAll("thead tr:first-child th"), (head) => head.textContent?.trim() ?? "");
      table.querySelectorAll<HTMLTableRowElement>("tbody > tr").forEach((row) => Array.from(row.cells).forEach((cell, index) => {
        const label = cell.colSpan > 1 ? "" : headings[index] ?? "";
        if (cell.dataset.label !== label) cell.dataset.label = label;
      }));
      });
      pendingTables.clear();
    };
    const queueTables = (node: Node) => {
      if (!(node instanceof Element)) return;
      const own = node.closest<HTMLTableElement>("table.table");
      if (own) pendingTables.add(own);
      node.querySelectorAll<HTMLTableElement>("table.table").forEach(table => pendingTables.add(table));
      if (pendingTables.size && !labelFrame) labelFrame = requestAnimationFrame(labelTables);
    };
    const refreshTables = () => queueTables(document.body);
    refreshTables(); breakpoint.addEventListener("change", refreshTables);
    const observer = new MutationObserver(records => {
      if (document.documentElement.dataset.mobile !== "true") return;
      for (const record of records) {
        const table = (record.target instanceof Element ? record.target : record.target.parentElement)?.closest<HTMLTableElement>("table.table");
        if (table) { pendingTables.add(table); if (!labelFrame) labelFrame = requestAnimationFrame(labelTables); }
        record.addedNodes.forEach(queueTables);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const viewport = window.visualViewport;
    const keyboard = () => {
      // Native resize also changes innerHeight. It must not overwrite the
      // official keyboard event with the browser-only viewport heuristic.
      if (Capacitor.isNativePlatform()) return;
      const focused = document.activeElement?.matches("input, textarea, select");
      document.documentElement.dataset.keyboard = String(!!focused && !!viewport && window.innerHeight - viewport.height > 150);
    };
    viewport?.addEventListener("resize", keyboard);
    document.addEventListener("focusout", keyboard);
    const handles: Array<{ remove: () => Promise<void> }> = [];
    let disposed = false;
    if (Capacitor.isNativePlatform()) {
      void (async () => {
        const [{ App }, { Keyboard }, { StatusBar, Style }] = await Promise.all([import("@capacitor/app"), import("@capacitor/keyboard"), import("@capacitor/status-bar")]);
        if (disposed) return;
        const register = async (promise: Promise<{ remove: () => Promise<void> }>) => { const handle = await promise; if (disposed) await handle.remove(); else handles.push(handle); };
        await register(App.addListener("backButton", () => {
          const closer = document.querySelector<HTMLButtonElement>("dialog[open] [data-mobile-dismiss]") ?? document.querySelector<HTMLButtonElement>("[data-mobile-dismiss]");
          if (closer) { closer.click(); return; }
          if (!confirmLeave()) return;
          const url = new URL(location.href);
          if (url.searchParams.has("menu")) { url.searchParams.delete("menu"); router.replace(url.pathname + url.search); return; }
          const trail = readNavigationTrail();
          if (["/", "/studio", "/me", "/my-wave"].includes(location.pathname)) { void App.minimizeApp(); return; }
          if (trail.length > 1) { approveHistoryBack(); router.back(); }
          else if (/(^\/(users|studios|roles|audit|notifications|announcements|my-wave)\/[^/]+)|(\/(registrations|teams|scores|results|waves|zones)\/[^/]+)|\/board$/.test(location.pathname)) router.replace(parentRoute(location.pathname));
          else { const home = document.querySelector<HTMLAnchorElement>(".console-brand, .personal-tabbar a")?.getAttribute("href") ?? "/login"; if(location.pathname !== home) router.replace(home); else void App.minimizeApp(); }
        }));
        await register(App.addListener("appStateChange", ({ isActive }) => { if (isActive && navigator.onLine && dirtyScreens.size === 0) router.refresh(); }));
        await register(Keyboard.addListener("keyboardWillShow", () => { document.documentElement.dataset.keyboard = "true"; }));
        await register(Keyboard.addListener("keyboardWillHide", () => { document.documentElement.dataset.keyboard = "false"; }));
        const colorScheme = matchMedia("(prefers-color-scheme: dark)");
        const updateStatus = () => {
          const theme = document.documentElement.dataset.theme;
          const dark = theme === "dark" || (theme !== "light" && colorScheme.matches);
          void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
        };
        updateStatus();
        const themeObserver = new MutationObserver(updateStatus);
        themeObserver.observe(document.documentElement, {attributes:true, attributeFilter:["data-theme"]});
        colorScheme.addEventListener("change", updateStatus);
        handles.push({remove:async()=>{themeObserver.disconnect();colorScheme.removeEventListener("change",updateStatus);}});
      })().catch(() => { /* Older store binaries and browsers keep web navigation. */ });
    }
    return () => {
      disposed = true;
      handles.forEach((handle) => { void handle.remove(); });
      observer.disconnect();
      cancelAnimationFrame(labelFrame);
      breakpoint.removeEventListener("change", refreshTables);
      breakpoint.removeEventListener("change", updateMobile);
      window.removeEventListener("online", updateNetwork); window.removeEventListener("offline", updateNetwork);
      window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", click, true);
      window.removeEventListener("popstate", popstate, true);
      viewport?.removeEventListener("resize", keyboard); document.removeEventListener("focusout", keyboard);
    };
  }, [router, t]);
  return offline ? <div className="mobile-network" role="status">{t("You are offline. Reconnect to save changes.")}</div> : null;
}
