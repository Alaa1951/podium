"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { AccountEditor } from "@/components/accounts/account-editor";
import { ACCOUNT_TYPE_LABEL, type AccountType } from "@/components/accounts/account-types";
import { DetailLink } from "@/components/app/detail-link";
import { useUnsavedChanges } from "@/components/app/mobile-runtime";
import { BlueprintCard } from "@/components/app/page-shell";
import { useIsMobile } from "@/components/app/use-mobile";
import { useLocale } from "@/components/i18n/locale-provider";
import { archiveAccount, inviteAccount, resendInvite, restoreAccount, setAccountStatus } from "@/lib/actions/accounts";
import { startViewAs } from "@/lib/actions/view-as";

export type { AccountType } from "@/components/accounts/account-types";

export type AccountRow = {
  id: string;
  email: string;
  name: string | null;
  role: AccountType;
  status: "invited" | "active" | "disabled";
  studioId: string | null;
  studioName: string | null;
  roles: { id: string; name: string; nameAr: string | null }[];
  lastLoginAt: string | null;
};

const ERRORS: Record<string, string> = {
  EMAIL_ALREADY_REGISTERED: "An account with that email already exists.",
  EMAIL_INVALID: "That email does not look right.",
  NAME_AND_EMAIL_REQUIRED: "Name and email are both needed.",
  STUDIO_REQUIRED: "Choose the studio this account manages.",
  CANNOT_CHANGE_OWN_ACCOUNT: "You cannot change your own account.",
  CANNOT_CHANGE_OWN_ACCESS: "You cannot change your own account.",
  FORBIDDEN: "You are not allowed to do that.",
};

export function AccountsPanel({
  accounts,
  studios,
  ownStudioName,
  archivedAccounts = [],
  ownUserId,
  detailId,
  editMode = false,
  compose = false,
  canInvite = false,
  canEdit = false,
  canDisable = false,
  canRemove = false,
  canViewAs = false,
  canInviteBft = false,
  basePath = "/users",
}: {
  accounts: AccountRow[];
  studios: { id: string; name: string }[];
  ownStudioName: string | null;
  /** Removed accounts — listed in their own strip, restorable. */
  archivedAccounts?: AccountRow[];
  ownUserId?: string;
  detailId?: string;
  editMode?: boolean;
  compose?: boolean;
  /** users.invite */
  canInvite?: boolean;
  /** users.edit — name, email, account type, studio. */
  canEdit?: boolean;
  /** users.disable */
  canDisable?: boolean;
  /** users.delete — remove and restore. */
  canRemove?: boolean;
  /** Admin holding no preview already: rows offer to see the app as them. */
  canViewAs?: boolean;
  /** BFT MENA inviting: any account type, any studio. A studio invites into its own. */
  canInviteBft?: boolean;
  /** Where this list lives: /users for BFT MENA, /studio/people for a studio. */
  basePath?: string;
}) {
  const { t, locale } = useLocale();
  const ar = locale === "ar";
  const router = useRouter();
  const mobile = useIsMobile();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [role, setRole] = useState<AccountType>(canInviteBft ? "organiser" : "competitor");
  // Which row is open for correction. One at a time: two editors on screen is
  // two chances to save the wrong person.
  const [editing, setEditing] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);

  const report = (result: { ok: boolean; error?: string; message?: string }) => {
    if (!result.ok) setError(t(ERRORS[result.error ?? ""] ?? "Something went wrong. Try again."));
    else if (result.message) setMessage(result.message);
    router.refresh();
  };
  const run = (work: () => Promise<{ ok: boolean; error?: string; message?: string }>) => {
    setMessage("");
    setError("");
    startTransition(async () => report(await work()));
  };

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
      setDirty(false);
      if (compose) router.replace(basePath);
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

  const statusLabel = (status: AccountRow["status"]) =>
    status === "active" ? t("Active") : status === "invited" ? t("Invited") : t("Disabled");
  const typeLabel = (type: AccountType) => t(ACCOUNT_TYPE_LABEL[type]);
  const roleNames = (account: AccountRow) =>
    account.roles.map((item) => (ar && item.nameAr ? item.nameAr : item.name));
  const inviteTypes: AccountType[] = canInviteBft
    ? ["organiser", "studio", "competitor", "staff", "admin"]
    : ["competitor", "organiser"];

  const actions = (account: AccountRow) => {
    const self = account.id === ownUserId;
    return (
      <>
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
        {canInvite ? (
          <button type="button" className="btn btn-ghost" onClick={() => run(() => resendInvite(account.id))} disabled={pending}>
            {account.status === "invited" ? t("Resend invitation") : t("Reset password")}
          </button>
        ) : null}
        {canDisable && !self ? (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={pending}
            onClick={() =>
              run(() =>
                setAccountStatus({ userId: account.id, status: account.status === "disabled" ? "active" : "disabled" })
              )
            }
          >
            {account.status === "disabled" ? t("Enable") : t("Disable")}
          </button>
        ) : null}
        {canRemove && !self ? (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={pending}
            style={{ color: "var(--status-danger-text)" }}
            onClick={() => {
              if (window.confirm(t("Remove {name} from the platform?", { name: account.name ?? account.email }))) {
                run(() => archiveAccount({ userId: account.id }));
              }
            }}
          >
            {t("Remove")}
          </button>
        ) : null}
      </>
    );
  };

  if (detailId) {
    const account = accounts.find((item) => item.id === detailId)!;
    if (editMode && canEdit) {
      return (
        <div className="mobile-detail">
          <h1>{account.name ?? account.email}</h1>
          <AccountEditor
            account={account}
            studios={studios}
            canMakeFullAdmin={canViewAs}
            onDone={() => router.replace(`${basePath}/${account.id}`)}
          />
        </div>
      );
    }
    return (
      <article className="mobile-detail">
        <h1>{account.name ?? account.email}</h1>
        <dl>
          <dt>{t("Email")}</dt>
          <dd>{account.email}</dd>
          <dt>{t("Account type")}</dt>
          <dd>{typeLabel(account.role)}</dd>
          <dt>{t("Studio")}</dt>
          <dd>{account.studioName ?? "—"}</dd>
          <dt>{t("Status")}</dt>
          <dd>{statusLabel(account.status)}</dd>
        </dl>
        {error ? <p className="notice-error" role="alert">{error}</p> : null}
        {message ? <p className="notice" role="status">{message}</p> : null}
        <div className="mobile-action-bar" style={{ flexWrap: "wrap" }}>
          {canEdit && account.id !== ownUserId ? (
            <DetailLink href={`${basePath}/${account.id}/edit`} className="btn btn-primary">
              {t("Edit")}
            </DetailLink>
          ) : null}
          {actions(account)}
        </div>
      </article>
    );
  }

  return (
    <>
      {canInvite && (!mobile || compose) ? (
        <BlueprintCard style={{ padding: "20px 22px", marginTop: 22, maxWidth: 560, gap: 10 }}>
          <div className="card-kicker">{t("Create an account")}</div>

          <form onInput={() => setDirty(true)} onSubmit={create} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <label className="field-label" htmlFor="ac-role">
                {t("Account type")}
              </label>
              <select id="ac-role" className="input" value={role} onChange={(e) => setRole(e.target.value as AccountType)}>
                {inviteTypes
                  .filter((type) => type !== "admin" || canViewAs)
                  .map((type) => (
                    <option key={type} value={type}>
                      {typeLabel(type)}
                    </option>
                  ))}
              </select>
              {!canInviteBft ? (
                <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "6px 0 0" }}>
                  {t("People you add here belong to {studio}.", { studio: ownStudioName ?? "—" })}
                </p>
              ) : null}
            </div>

            <div>
              <label className="field-label" htmlFor="ac-name">
                {t("Name")}
              </label>
              <input id="ac-name" name="name" className="input" required placeholder={t("Full name")} />
            </div>

            <div>
              <label className="field-label" htmlFor="ac-email">
                {t("Email")}
              </label>
              <input id="ac-email" name="email" type="email" className="input" required placeholder="name@email.com" />
            </div>

            {canInviteBft && role !== "admin" && role !== "staff" ? (
              <div>
                <label className="field-label" htmlFor="ac-studio">
                  {t("Studio")}
                </label>
                <select id="ac-studio" name="studioId" className="input" required={role === "studio"}>
                  {role !== "studio" ? <option value="">{t("No studio")}</option> : null}
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
                "The account is created with no password. They receive a link by email and choose one themselves. Give them roles from their Access panel once it exists."
              )}
            </p>
          </form>
        </BlueprintCard>
      ) : canInvite && !compose ? (
        <Link href={`${basePath}/new`} className="btn btn-primary">
          {t("Create an account")}
        </Link>
      ) : null}

      {message ? <div className="notice" style={{ marginTop: 16 }}>{message}</div> : null}
      {error ? (
        <div className="notice-error" style={{ marginTop: 16 }} role="alert">
          {error}
        </div>
      ) : null}

      {!compose ? (
        <>
          <h2 className="section-title">{t("Active accounts")}</h2>
          {mobile ? (
            <div className="mobile-list">
              {accounts.map((account) => (
                <DetailLink key={account.id} href={`${basePath}/${account.id}`}>
                  <div>
                    <strong>{account.name ?? account.email}</strong>
                    <small>{account.email}</small>
                    <small>{roleNames(account).join(" · ") || typeLabel(account.role)}</small>
                  </div>
                  <span className="badge">{statusLabel(account.status)}</span>
                  <span aria-hidden="true">›</span>
                </DetailLink>
              ))}
            </div>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("Name")}</th>
                    <th>{t("Email")}</th>
                    <th style={{ width: 150 }}>{t("Account type")}</th>
                    <th>{t("Roles")}</th>
                    <th style={{ width: 130 }}>{t("Studio")}</th>
                    <th style={{ width: 100 }}>{t("Status")}</th>
                    <th style={{ width: 260 }}>{t("Action")}</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.flatMap((account) => [
                    <tr key={account.id}>
                      <td style={{ fontFamily: "var(--font-heading)", fontWeight: 600 }}>{account.name ?? "—"}</td>
                      <td style={{ fontSize: 13 }}>{account.email}</td>
                      <td>{typeLabel(account.role)}</td>
                      <td>
                        {account.role === "admin" ? (
                          <span className="reg-sub">{t("Everything")}</span>
                        ) : (
                          <div className="role-chips">
                            {roleNames(account).map((name) => (
                              <span key={name} className="role-chip" style={{ paddingInlineEnd: 10 }}>
                                {name}
                              </span>
                            ))}
                            {!account.roles.length ? <span className="reg-sub">{t("Default")}</span> : null}
                          </div>
                        )}
                      </td>
                      <td>{account.studioName ?? "—"}</td>
                      <td>
                        <span className={account.status === "active" ? "tag tag-outline" : "tag tag-outline-muted"}>
                          {statusLabel(account.status)}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <Link href={`${basePath}/${account.id}`} className="btn btn-secondary">
                            {t("Access")}
                          </Link>
                          {canEdit && account.id !== ownUserId ? (
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
                          {actions(account)}
                        </div>
                      </td>
                    </tr>,
                    editing === account.id ? (
                      <tr key={`${account.id}-edit`} className="reg-detail">
                        <td colSpan={7}>
                          <AccountEditor
                            account={account}
                            studios={studios}
                            canMakeFullAdmin={canViewAs}
                            onDone={() => setEditing(null)}
                          />
                        </td>
                      </tr>
                    ) : null,
                  ])}
                  {accounts.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ color: "var(--text-secondary)" }}>
                        {t("No accounts yet.")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}

          {canRemove && archivedAccounts.length > 0 ? (
            <div style={{ marginTop: 16 }}>
              <button type="button" className="linkish" style={{ fontSize: 13 }} onClick={() => setShowArchived((v) => !v)}>
                {showArchived ? t("Hide archived") : t("Archived accounts ({n})", { n: archivedAccounts.length })}
              </button>
              {showArchived ? (
                <div className="table-scroll" style={{ marginTop: 10 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t("Name")}</th>
                        <th>{t("Email")}</th>
                        <th style={{ width: 150 }}>{t("Account type")}</th>
                        <th style={{ width: 110 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {archivedAccounts.map((account) => (
                        <tr key={account.id}>
                          <td>{account.name ?? "—"}</td>
                          <td style={{ fontSize: 13 }}>{account.email}</td>
                          <td>{typeLabel(account.role)}</td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-sm btn-secondary"
                              disabled={pending}
                              onClick={() => run(() => restoreAccount({ userId: account.id }))}
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
      ) : null}
    </>
  );
}
