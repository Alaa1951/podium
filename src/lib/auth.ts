import "server-only";

import type { NextAuthOptions } from "next-auth";

import type { Role, UserStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { providers } from "@/lib/auth-providers";
import type { SessionUser } from "@/lib/auth-shared";

export { AUTH_ERRORS } from "@/lib/auth-shared";

// How long each kind of person stays signed in.
//
// Staff get an event day, not a fortnight: a laptop left open on a gym floor
// is the realistic threat, and twelve hours covers the longest day anyone
// works. A competitor gets a full day, because they sign in once in the
// morning and want to still be in that evening when the results are argued
// over — and their session can reach nothing but their own result.
const SESSION_HOURS: Record<string, number> = {
  admin: 12,
  studio: 12,
  competitor: 24,
};

/** The cookie has to outlive the longest of them; the token expires sooner. */
const SESSION_MAX_AGE = 24 * 3_600;

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
        // The role's own deadline, stamped at sign-in. The cookie is longer
        // than this for everyone but a competitor; session.ts is what enforces
        // it, so a token that outlives its role simply stops resolving.
        token.expiresAt = Date.now() + (SESSION_HOURS[u.role] ?? 12) * 3_600_000;
        token.studioId = u.studioId;
        token.locale = u.locale;
        token.refreshedAt = Date.now();
        return token;
      }

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
