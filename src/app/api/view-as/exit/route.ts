import { NextResponse } from "next/server";

import { getBaseUrl } from "@/lib/security";
import { clearViewAsCookie } from "@/lib/view-as";

/**
 * End the preview and land back on the admin's own dashboard. A GET on
 * purpose: Server Actions are refused while a preview is open, so the way out
 * must not be one. The only thing it can do is drop a cookie — the worst a
 * stray click can do is end somebody's preview.
 *
 * The target comes from configuration, not from the request: behind the
 * reverse proxy the app only knows its own loopback address, and a redirect
 * built from that would drop the admin onto a link no browser but the
 * server's own can open.
 */
export async function GET() {
  await clearViewAsCookie();
  return NextResponse.redirect(`${getBaseUrl()}/`);
}
