"use client";

import type { ReactNode } from "react";
import { ConsoleShell, type NavGroup } from "@/components/app/console-shell";
import { PlainHeader } from "@/components/app/plain-header";
import { useIsMobile } from "@/components/app/use-mobile";

/** Wall displays keep their full-screen frame; phones retain app navigation. */
export function MobileBoardShell({ children, groups, name, title, homeHref, overviewHref, utilities }: {
  children: ReactNode;
  groups: NavGroup[];
  name: string;
  title: string;
  homeHref: string;
  overviewHref: string;
  utilities: ReactNode;
}) {
  const mobile = useIsMobile();
  if (!mobile) return children;
  if (!groups.length) return <><PlainHeader roleLabel={title} homeHref={homeHref} backHref={homeHref} />{children}</>;
  return <ConsoleShell groups={groups} crumbs={[{href:overviewHref,label:name}]} contextName={name} contextHref={overviewHref} homeHref={homeHref} utilities={utilities}>{children}</ConsoleShell>;
}
