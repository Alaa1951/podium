import { NextResponse, type NextRequest } from "next/server";

// Next.js 16 renamed `middleware` to `proxy`. It runs on the Node.js runtime.
//
// Two jobs, both cheap:
//   1. security headers on every response;
//   2. an early bounce to /login when no session cookie is present.
//
// The bounce is a convenience, NOT the access control. Authorization is decided
// in the page and route handlers (src/lib/session.ts) against the database — a
// forged cookie gets past this and no further.

const PUBLIC_PATHS = [
  "/login",
  "/competitor",
  "/verify",
  "/activate",
  "/reset-password",
  "/forgot-password",
  // The published results. A finished competition is public — the whole point
  // of a podium is that everyone can see who is on it — and the pages below
  // decide for themselves which competitions have reached that state. The
  // /api/results poll is the same view over JSON. (No trailing slashes here:
  // the matcher below appends one.)
  "/results",
  "/api/results",
  // Sponsor logo artwork. Wall boards and published results render these
  // images without a session, and the bytes are marketing material — public
  // by nature. The route itself 404s anything unknown; nothing else under
  // /api opens up with it.
  "/api/sponsors",
];

const SESSION_COOKIES = ["next-auth.session-token", "__Secure-next-auth.session-token"];

/**
 * The app loads nothing from anywhere else: fonts are self-hosted by
 * `next/font`, the brand marks are local files, and there is no analytics or
 * embed. So the policy can be closed almost completely.
 *
 * `'unsafe-inline'` on styles is unavoidable while the design uses inline
 * `style` attributes; scripts get a per-request nonce instead, and in
 * development also `'unsafe-eval'`, which the Turbopack HMR client needs.
 */
function contentSecurityPolicy(nonce: string) {
  const dev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

function securityHeaders(response: NextResponse, policy: string) {
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-DNS-Prefetch-Control", "off");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"
  );
  // Nothing here is for a search engine, and half of it is competitor data.
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  if (process.env.NODE_ENV === "production") {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload"
    );
  }
  return response;
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // One nonce per request. Next reads the policy off the REQUEST headers to
  // stamp its own framework and bundle scripts, so the same value has to go
  // both ways — request in, response out.
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const policy = contentSecurityPolicy(nonce);

  const forward = new Headers(request.headers);
  forward.set("x-nonce", nonce);
  forward.set("Content-Security-Policy", policy);
  const pass = () => NextResponse.next({ request: { headers: forward } });

  const isPublic =
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    pathname === "/api/health" ||
    pathname.startsWith("/api/auth/");

  if (isPublic) return securityHeaders(pass(), policy);

  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (!hasSession) {
    // An API caller gets an answer it can act on; a browser gets the sign-in
    // screen with somewhere to come back to.
    if (pathname.startsWith("/api/")) {
      return securityHeaders(NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }), policy);
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?callbackUrl=${encodeURIComponent(pathname + search)}`;
    return securityHeaders(NextResponse.redirect(url), policy);
  }

  return securityHeaders(pass(), policy);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/).*)"],
};
