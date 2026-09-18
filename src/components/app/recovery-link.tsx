"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { safeAppPath } from "@/lib/mobile-navigation";

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

export function RecoveryLink({fallback = "/login", children, className}:{fallback?:string;children:React.ReactNode;className?:string}) {
  const href = useSyncExternalStore(subscribe, () => {
    try { const saved = safeAppPath(sessionStorage.getItem("podium:lastPath")); if(saved && saved.split("?")[0] !== location.pathname) return saved; } catch { /* Use the server's safe home. */ }
    return fallback;
  }, () => fallback);
  return <Link href={href} className={className} style={{textDecoration:"none"}}>{children}</Link>;
}
