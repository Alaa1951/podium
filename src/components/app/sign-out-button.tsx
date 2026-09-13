"use client";

import { signOut } from "next-auth/react";

import { useT } from "@/components/i18n/locale-provider";

/** The way out of the console: back to the sign-in screen, session cleared. */
export function SignOutButton() {
  const t = useT();

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={() => signOut({ callbackUrl: "/login" })}
    >
      {t("Sign out")}
    </button>
  );
}
