"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The prompt itself — hidden on the waiver pages, where it would only point at itself. */
export function WaiverPromptBar({ href, text, action }: { href: string; text: string; action: string }) {
  const path = usePathname();
  if (path.startsWith("/waivers")) return null;
  return (
    <div className="waiver-prompt" role="status" data-testid="waiver-prompt">
      <span>{text}</span>
      <Link href={href} className="btn btn-primary btn-sm">{action}</Link>
    </div>
  );
}
