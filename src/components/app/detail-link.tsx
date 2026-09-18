"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { readNavigationTrail } from "@/components/app/mobile-runtime";
import type { ReactNode } from "react";

export function DetailLink({ href, children, className = "mobile-list-card" }: { href: string; children: ReactNode; className?: string }) {
  const path = usePathname();
  return <Link href={href} className={className} onClick={() => {
    sessionStorage.setItem(`podium:list:${path}`, JSON.stringify({ href: path + location.search, scroll: window.scrollY }));
    const trail = readNavigationTrail();
    if (trail.length) trail[trail.length - 1] = path + location.search;
    sessionStorage.setItem("podium:trail", JSON.stringify(trail));
  }}>{children}</Link>;
}

/** URL filters survive a detail route, reload and the platform's Back button. */
export function useListFilter(key: string, fallback = "all") {
  const search = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const value = search.get(key) ?? fallback;
  const setValue = (next: string) => {
    const params = new URLSearchParams(search.toString());
    if (next === fallback) params.delete(key); else params.set(key, next);
    window.history.replaceState(null, "", `${path}${params.size ? `?${params}` : ""}`);
  };
  return [value, setValue, router] as const;
}
