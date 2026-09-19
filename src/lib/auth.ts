import "server-only";

import type { NextAuthOptions } from "next-auth";

import type { Role, UserStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { providers } from "@/lib/auth-providers";
import type { SessionUser } from "@/lib/auth-shared";
import { nextSessionDeadline, SESSION_IDLE_MS } from "@/lib/session-deadline";

export { AUTH_ERRORS } from "@/lib/auth-shared";

// Everyone stays signed in until they sign out, or until 30 days pass without
// using the app (session-deadline.ts). The cookie and the token live as long.
const SESSION_MAX_AGE = SESSION_IDLE_MS / 1000;

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  providers,
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE,
    updateAge: 3_600,
  },
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-next-auth.session-token"
          : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        maxAge: SESSION_MAX_AGE,
      },
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as unknown as SessionUser;
        token.sub = u.id;
        token.role = u.role;
        token.status = u.status;
        token.accessRoleId = u.accessRoleId ?? null;
        // The idle deadline, enforced by session.ts on every request.
        token.expiresAt = Date.now() + SESSION_IDLE_MS;
        token.studioId = u.studioId;
        token.locale = u.locale;
        token.refreshedAt = Date.now();
        return token;
      }

      // Using the app moves the idle deadline forward; the re-issued cookie
      // carries it. An already expired session stays expired.
      token.expiresAt = nextSessionDeadline(token.expiresAt);

      // Re-read role, studio and status on a throttle so a change an admin
      // makes takes effect without forcing a sign-out — and so a disabled or
      // archived account loses access inside the window rather than at token
      // expiry.
      const REFRESH_MS = 5 * 60_000;
      const last = typeof token.refreshedAt === "number" ? token.refreshedAt : 0;
      if (token.sub && Date.now() - last > REFRESH_MS) {
        try {
          const fresh = await prisma.user.findUnique({
            where: { id: token.sub },
            select: {
              role: true,
              status: true,
              studioId: true,
              locale: true,
              name: true,
              archivedAt: true,
              accessRoleId: true,
            },
          });
          if (fresh && !fresh.archivedAt) {
            token.role = fresh.role;
            token.status = fresh.status;
            token.accessRoleId = fresh.accessRoleId;
            token.studioId = fresh.studioId;
            token.locale = fresh.locale;
            token.name = fresh.name;
          } else {
            // Missing row (never happens) or an archived account: no access.
            token.status = "disabled";
          }
          token.refreshedAt = Date.now();
        } catch (error) {
          console.warn("[AUTH] token refresh failed", error instanceof Error ? error.message : error);
        }
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.role = (token.role as Role) ?? "competitor";
        session.user.status = (token.status as UserStatus) ?? "active";
        session.user.accessRoleId = (token.accessRoleId as string | null) ?? null;
        session.user.studioId = (token.studioId as string | null) ?? null;
        session.user.locale = (token.locale as string) ?? "en";
        session.user.expiresAt = token.expiresAt as number | undefined;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};
