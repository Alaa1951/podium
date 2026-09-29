"use client";

import Link from "next/link";

import { useT } from "@/components/i18n/locale-provider";

/**
 * A code or link that was right but cannot be used: it went to an address the
 * account no longer has, or it predates recipient records. Nothing happened
 * to the account. Two ways forward, both to the account's CURRENT address,
 * both answering the same way whatever the address's state — a fresh code
 * (the athlete's way in; no password needed), or a link to set a password.
 */
export function RefusedCodeNotice({ kind }: { kind: "code" | "link" }) {
  const t = useT();
  return (
    <div className="notice-error" role="alert" style={{ marginBottom: 14 }}>
      <strong>{kind === "code" ? t("This code can't be used any more.") : t("This link can't be used any more.")}</strong>
      <p style={{ margin: "6px 0 10px" }}>
        {t("It was sent to an address this account no longer uses, or it is too old. Nothing has changed on the account. Ask for a new one:")}
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        <Link href="/athlete" className="btn btn-block btn-primary">
          {t("Send me a sign-in code")}
        </Link>
        <Link href="/forgot-password" className="btn btn-block btn-primary-outline">
          {t("Send me a link to set a password")}
        </Link>
      </div>
    </div>
  );
}
