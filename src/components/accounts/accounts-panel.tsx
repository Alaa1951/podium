"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { BlueprintCard } from "@/components/app/page-shell";
import { AccountEditor } from "@/components/accounts/account-editor";
import { useT } from "@/components/i18n/locale-provider";
import { inviteAccount, resendInvite, setAccountStatus } from "@/lib/actions/accounts";
import { archiveAccount, restoreAccount } from "@/lib/actions/accounts";
import { startViewAs } from "@/lib/actions/view-as";

export type AccountRow = {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "studio" | "competitor";
  status: "invited" | "active" | "disabled";
  studioId: string | null;
  studioName: string | null;
  accessRoleId?: string | null;
  lastLoginAt: string | null;
};

const ERRORS: Record<string, string> = {
  EMAIL_ALREADY_REGISTERED: "An account with that email already exists.",
  EMAIL_INVALID: "That email does not look right.",
  NAME_AND_EMAIL_REQUIRED: "Name and email are both needed.",
  STUDIO_REQUIRED: "Choose the studio this account manages.",
  CANNOT_CHANGE_OWN_ACCOUNT: "You cannot change your own account.",
  FORBIDDEN: "You are not allowed to do that.",
};

export function AccountsPanel({
  accounts,
  studios,
  isAdmin,
  ownStudioName,
  accessRoles = [],
  archivedAccounts = [],
  ownUserId,
  canViewAs = false,
}: {
  accounts: AccountRow[];
  studios: { id: string; name: string }[];
  isAdmin: boolean;
  ownStudioName: string | null;
  /** Named permission bundles, assignable from the account editor. */
  accessRoles?: { id: string; name: string }[];
  /** Removed accounts — listed in their own strip, restorable. Admin only. */
  archivedAccounts?: AccountRow[];
  ownUserId?: string;
  /** Admin holding no preview already: rows offer to see the app as them. */
  canViewAs?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [role, setRole] = useState<"admin" | "studio" | "competitor">(isAdmin ? "studio" : "competitor");
  // Which row is open for correction. One at a time: two editors on screen is
  // two chances to save the wrong person.
  const [editing, setEditing] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setMessage("");
    setError("");

    startTransition(async () => {
      const result = await inviteAccount({
        name: String(data.get("name") || ""),
        email: String(data.get("email") || ""),
        role,
        studioId: String(data.get("studioId") || "") || undefined,
      });

      if (!result.ok) {
        setError(t(ERRORS[result.error] ?? "Something went wrong. Try again."));
        return;
      }
      setMessage(result.message ?? "");
      form.reset();
      router.refresh();
    });
  }

  function resend(userId: string) {
    setMessage("");
    setError("");
    startTransition(async () => {
      const result = await resendInvite(userId);
      if (!result.ok) setError(t(ERRORS[result.error] ?? "Something went wrong. Try again."));
      else setMessage(result.message ?? "");
      router.refresh();
    });
  }

  /** See the app as this account sees it. The action redirects to that
   *  account's own home; a banner above every screen ends the preview. */
  function viewAs(userId: string) {
    setError("");
    startTransition(async () => {
      const result = await startViewAs(userId);
      if (result.ok === false) {
        setError(t(ERRORS[result.error] ?? "Something went wrong. Try again."));
        router.refresh();
      }
    });
  }

  function toggleStatus(userId: string, next: "active" | "disabled") {
    setMessage("");
    setError("");
    startTransition(async () => {
      const result = await setAccountStatus({ userId, status: next });
      if (!result.ok) setError(t(ERRORS[result.error] ?? "Something went wrong. Try again."));
      router.refresh();
    });
  }

  /** Remove = ARCHIVE. The account leaves the list and loses access; nothing
   *  is hard-deleted and it can be restored from the strip below. */
  function remove(userId: string) {
    setMessage("");
    setError("");
    startTransition(async () => {
      const result = await archiveAccount({ userId });
      if (!result.ok) setError(t(ERRORS[result.error] ?? "Something went wrong. Try again."));
      else router.refresh();
    });
  }

  function restore(userId: string) {
    setMessage("");
    setError("");
    startTransition(async () => {
      const result = await restoreAccount({ userId });
      if (!result.ok) setError(t(ERRORS[result.error] ?? "Something went wrong. Try again."));
      else router.refresh();
    });
  }

  const statusLabel = (status: AccountRow["status"]) =>
    status === "active" ? t("Active") : status === "invited" ? t("Invited") : t("Disabled");

  return (
    <>
      <BlueprintCard style={{ padding: "20px 22px", marginTop: 22, maxWidth: 560, gap: 10 }}>
        <div className="card-kicker">{t("Create an account")}</div>

        <form onSubmit={create} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {isAdmin ? (
            <div>
              <label className="field-label" htmlFor="ac-role">
                {t("Access level")}
              </label>
              <select
                id="ac-role"
                className="input"
                value={role}
                onChange={(e) => setRole(e.target.value as typeof role)}
              >
                <option value="admin">{t("BFT MENA · full admin")}</option>
                <option value="studio">{t("Studio")}</option>
                <option value="competitor">{t("Member")}</option>
              </select>
            </div>
          ) : (
            <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>
              {t("Competitors you add here belong to {studio} and are activated by you.", {
                studio: ownStudioName ?? "—",
              })}
            </p>
          )}

          <div>
            <label className="field-label" htmlFor="ac-name">
              {t("Name")}
            </label>
            <input id="ac-name" name="name" className="input" required placeholder="Full name" />
          </div>

          <div>
            <label className="field-label" htmlFor="ac-email">
              {t("Email")}
            </label>
            <input
              id="ac-email"
              name="email"
              type="email"
              className="input"
              required
              placeholder="name@email.com"
            />
          </div>

          {isAdmin && role !== "admin" ? (
            <div>
              <label className="field-label" htmlFor="ac-studio">
                {t("Studio")}
              </label>
              <select id="ac-studio" name="studioId" className="input" required={role === "studio"}>
                {role === "competitor" ? <option value="">{t("Non-member")}</option> : null}
                {studios.map((studio) => (
                  <option key={studio.id} value={studio.id}>
                    {studio.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
            {pending ? <span className="spinner" /> : null}
            {t("Send invitation")}
          </button>

          <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0 }}>
            {t(
              "The account is created with no password. They receive a link by email and choose one themselves — nothing is set here."
            )}
          </p>
        </form>
      </BlueprintCard>

      {message ? (
        <div className="notice" style={{ marginTop: 16 }}>
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="notice-error" style={{ marginTop: 16 }} role="alert">
          {error}
        </div>
      ) : null}

      <h2 className="section-title">{t("Active accounts")}</h2>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>{t("Name")}</th>
              <th>{t("Email")}</th>
              <th style={{ width: 130 }}>{t("Access level")}</th>
              <th style={{ width: 140 }}>{t("Studio")}</th>
              <th style={{ width: 110 }}>{t("Status")}</th>
              <th style={{ width: 210 }}>{t("Action")}</th>
            </tr>
          </thead>
          <tbody>
            {accounts.flatMap((account) => [
              <tr key={account.id}>
                <td style={{ fontFamily: "var(--font-heading)", fontWeight: 600 }}>
                  {account.name ?? "—"}
                </td>
                <td style={{ fontSize: 13 }}>{account.email}</td>
                <td>
                  {account.role === "admin"
                    ? t("BFT MENA")
                    : account.role === "studio"
                      ? t("Studio")
                      : t("Member")}
                </td>
                <td>{account.studioName ?? "—"}</td>
                <td>
                  <span
                    className={
                      account.status === "active" ? "tag tag-outline" : "tag tag-outline-muted"
                    }
                  >
                    {statusLabel(account.status)}
                  </span>
                </td>
                <td>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {isAdmin ? (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setEditing(editing === account.id ? null : account.id)}
                        disabled={pending}
                        aria-expanded={editing === account.id}
                      >
                        {editing === account.id ? t("Close") : t("Edit")}
                      </button>
                    ) : null}
                    {canViewAs && account.role !== "admin" && account.status === "active" ? (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => viewAs(account.id)}
                        disabled={pending}
                        title={t("See the app as this account sees it — read-only.")}
                      >
                        {t("View as")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => resend(account.id)}
                      disabled={pending}
                    >
                      {account.status === "invited" ? t("Resend invitation") : t("Reset password")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() =>
                        toggleStatus(
                          account.id,
                          account.status === "disabled" ? "active" : "disabled"
                        )
                      }
                      disabled={pending}
                    >
                      {account.status === "disabled" ? t("Enable") : t("Disable")}
                    </button>
                    {isAdmin && account.id !== ownUserId ? (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={pending}
                        onClick={() => remove(account.id)}
                        style={{ color: "var(--status-danger-text)" }}
                      >
                        {t("Remove")}
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>,

              editing === account.id ? (
                <tr key={`${account.id}-edit`} className="reg-detail">
                  <td colSpan={6}>
                    <AccountEditor
                      account={{
                        id: account.id,
                        name: account.name,
                        email: account.email,
                        role: account.role,
                        studioId: account.studioId,
                        accessRoleId: account.accessRoleId ?? null,
                      }}
                      accessRoles={accessRoles}
                      studios={studios}
                      onDone={() => setEditing(null)}
                    />
                  </td>
                </tr>
              ) : null,
            ])}

            {accounts.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ color: "var(--text-secondary)" }}>
                  {t("No accounts yet.")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {isAdmin && archivedAccounts.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <button
            type="button"
            className="linkish"
            style={{ fontSize: 13 }}
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived
              ? t("Hide archived")
              : t("Archived accounts ({n})", { n: archivedAccounts.length })}
          </button>

          {showArchived ? (
            <div className="table-scroll" style={{ marginTop: 10 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("Name")}</th>
                    <th>{t("Email")}</th>
                    <th style={{ width: 130 }}>{t("Access level")}</th>
                    <th style={{ width: 110 }} />
                  </tr>
                </thead>
                <tbody>
                  {archivedAccounts.map((account) => (
                    <tr key={account.id}>
                      <td>{account.name ?? "—"}</td>
                      <td style={{ fontSize: 13 }}>{account.email}</td>
                      <td>
                        {account.role === "admin"
                          ? t("BFT MENA")
                          : account.role === "studio"
                            ? t("Studio")
                            : t("Member")}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          disabled={pending}
                          onClick={() => restore(account.id)}
                        >
                          {t("Restore")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
