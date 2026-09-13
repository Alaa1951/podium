import type { DefaultSession } from "next-auth";

import type { Role, UserStatus } from "@/generated/prisma/enums";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      status: UserStatus;
      /** The access role this account carries, when it has one. */
      accessRoleId?: string | null;
      studioId: string | null;
      locale: string;
      expiresAt?: number;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: Role;
    status?: UserStatus;
    accessRoleId?: string | null;
    studioId?: string | null;
    locale?: string;
    refreshedAt?: number;
    /** When this session stops being valid, per the role's own length. */
    expiresAt?: number;
  }
}
