"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

export function AuthProvider({ children }: { children: ReactNode }) {
  // No polling: pages read the session on the server, and the JWT already
  // refreshes role and status on its own throttle.
  return <SessionProvider refetchInterval={0}>{children}</SessionProvider>;
}
