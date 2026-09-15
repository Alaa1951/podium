import { NextResponse, type NextRequest } from "next/server";

import { clearViewAsCookie } from "@/lib/view-as";

/**
 * End the preview and land back on the admin's own dashboard. A GET on
 * purpose: Server Actions are refused while a preview is open, so the way out
 * must not be one. The only thing it can do is drop a cookie — the worst a
 * stray click can do is end somebody's preview.
 */
export async function GET(request: NextRequest) {
  await clearViewAsCookie();
  return NextResponse.redirect(new URL("/", request.url));
}
