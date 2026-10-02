"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";

/** Server-filtered lists keep the typed draft while older responses arrive. */
export function useServerSearch(query: string) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(query);
  const [requested, setRequested] = useState<string[]>([]);
  const [lastQuery, setLastQuery] = useState(query);

  if (lastQuery !== query) {
    setLastQuery(query);
    if (!requested.includes(query)) setText(query);
    setRequested(requested.filter((value) => value !== query));
  }

  const apply = useCallback((changes: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    if (text.trim()) next.set("q", text.trim());
    else next.delete("q");
    for (const [key, value] of Object.entries(changes)) {
      if (!value || value === "all") next.delete(key);
      else next.set(key, key === "q" ? value.trim() : value);
    }
    next.delete("page");
    const nextQuery = next.get("q") ?? "";
    setRequested((values) => [...values.filter((value) => value !== nextQuery).slice(-19), nextQuery]);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }, [params, pathname, router, text]);

  useEffect(() => {
    const restore = () => {
      setRequested([]);
      setText(new URLSearchParams(window.location.search).get("q") ?? "");
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  useEffect(() => {
    if (text.trim() === query.trim()) return;
    const id = setTimeout(() => apply({ q: text.trim() }), 250);
    return () => clearTimeout(id);
  }, [text, query, apply]);

  return { text, setText, apply, pending: pending || text.trim() !== query.trim() };
}
