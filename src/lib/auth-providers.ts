import "server-only";

import type { NextAuthOptions } from "next-auth";

import { passwordProviders } from "@/lib/auth-password";

/**
 * Every way into PODIUM.
 *
 * Email + password (with the emailed code for untrusted devices) for staff,
 * and the emailed code alone for competitors. A removed Google sign-in lived
 * here once — it was taken out by decision: every sign-in must use an email
 * PODIUM already knows, and no account is ever created or matched through an
 * outside identity provider.
 */
export const providers: NextAuthOptions["providers"] = [...passwordProviders];
