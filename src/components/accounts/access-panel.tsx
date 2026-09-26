"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { useUnsavedChanges } from "@/components/app/mobile-runtime";
import { useLocale } from "@/components/i18n/locale-provider";
import { PermissionTree } from "@/components/permissions/permission-tree";
import { assignAccessRole, removeAccessRole, savePermissionOverrides } from "@/lib/actions/user-access";
import type {
  AccessPanelData,
  AccessRow,
  OverrideState,
  RowLock,
  RowSource,
} from "@/lib/permissions/access-panel";

// ─────────────────────────────────────────────────────────────────────────────
// ONE PERSON'S ACCESS.
//
// Top: the roles they hold, as chips, with "+ Give a role". Below: every
// permission in the system with where it comes from (a role, a grant, a lock,
// always-on) and — for BFT MENA — an Inherit / Grant / Lock control per row.
// A lock always wins. Everything here was decided by the server; this
// component only collects the viewer's changes and sends them back.
// ─────────────────────────────────────────────────────────────────────────────

const ERRORS: Record<string, string> = {
  STALE: "Someone else changed this person's access while you were editing. Reload to see it.",
  NOT_HELD: "You can only give permissions you hold yourself.",
  ROLE_NOT_ASSIGNABLE: "Studios can't give this role.",
  ROLE_NOT_FOR_ACCOUNT_TYPE: "That role is not meant for this kind of account.",
  CANNOT_CHANGE_OWN_ACCESS: "You cannot change your own access — ask someone else.",
  FORBIDDEN: "You are not allowed to do that.",
  NOT_STORABLE: "That permission can't be granted to anyone.",
  NOT_FOUND: "That person or role no longer exists.",
};

const LOCKS: Record<Exclude<RowLock, null>, string> = {
  FULL_ADMIN_ONLY: "BFT MENA Full access only",
  ABOVE_ACCOUNT_TYPE: "Not for this account type",
  NOT_HELD: "You don't hold this",
  ALWAYS_ON: "Always on",
};

function sourceText(source: RowSource, t: (key: string, vars?: Record<string, string>) => string): string {
  switch (source.kind) {
    case "general":
      return t("Always on");
    case "role":
      return t("From role: {roles}", { roles: source.roles.join(", ") });
    case "grant":
      return t("Granted to this person");
    case "lock":
      return t("Locked for this person");
    case "ceiling":
      return t("Given, but not for this account type");
    default:
      return "—";
  }
}

export function AccessPanel({ data }: { data: AccessPanelData }) {
  const { t, locale } = useLocale();
  const ar = locale === "ar";
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [picking, setPicking] = useState("");

  const initial = useMemo(() => {
    const map: Record<string, OverrideState> = {};
    for (const group of data.modules)
      for (const screen of group.screens) for (const row of screen.rows) map[row.key] = row.state;
    return map;
  }, [data]);
  const [states, setStates] = useState(initial);
  const dirty = JSON.stringify(states) !== JSON.stringify(initial);
  useUnsavedChanges(dirty);

  function fail(result: { error: string; keys?: string[] }) {
    setMessage("");
    const base = t(ERRORS[result.error] ?? "Something went wrong. Try again.");
    setError(result.keys?.length ? `${base} (${result.keys.join(", ")})` : base);
  }

  function give() {
    if (!picking) return;
    setError("");
    startTransition(async () => {
      const result = await assignAccessRole({ userId: data.userId, roleId: picking });
      if (!result.ok) return fail(result);
      setPicking("");
      setMessage(t("Role given."));
      router.refresh();
    });
  }

  function take(roleId: string, name: string) {
    if (!window.confirm(t("Take the role {name} away?", { name }))) return;
    setError("");
    startTransition(async () => {
      const result = await removeAccessRole({ userId: data.userId, roleId });
      if (!result.ok) return fail(result);
      setMessage(t("Role taken away."));
      router.refresh();
    });
  }

  function saveOverrides() {
    const grant = Object.entries(states).filter(([, state]) => state === "grant").map(([key]) => key);
    const deny = Object.entries(states).filter(([, state]) => state === "lock").map(([key]) => key);
    setError("");
    startTransition(async () => {
      const result = await savePermissionOverrides({ userId: data.userId, grant, deny, loadedAt: data.loadedAt });
      if (!result.ok) return fail(result);
      setMessage(t("Saved."));
      router.refresh();
    });
  }

  const name = (item: { name: string; nameAr: string | null }) => (ar && item.nameAr ? item.nameAr : item.name);

  if (data.isFullAdmin) {
    return (
      <section className="card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>{t("Access")}</h2>
        <p className="reg-sub">{t("BFT MENA Full access passes every check. Roles and locks do not apply.")}</p>
      </section>
    );
  }

  const row = (item: AccessRow) => {
    const state = states[item.key] ?? "inherit";
    const setState = (next: OverrideState) => setStates((current) => ({ ...current, [item.key]: next }));
    const lock = item.grantLock && item.lockLock ? item.lockLock : null;
    return (
      <div className="perm-row" data-effective={item.effective}>
        <span className="perm-row-label">
          <span className="perm-dot" aria-label={item.effective ? t("Allowed") : t("Not allowed")} />
          <span>{ar ? item.labelAr : t(item.label)}</span>
          <span className="perm-row-key">{item.key}</span>
        </span>
        <span className="perm-source">{sourceText(item.source, t)}</span>
        {data.canOverride ? (
          <span className="seg" role="group" aria-label={t("Access for this permission")}>
            <button type="button" data-active={state === "inherit" ? "inherit" : undefined} disabled={pending} onClick={() => setState("inherit")}>
              {t("Inherit")}
            </button>
            <button
              type="button"
              data-active={state === "grant" ? "grant" : undefined}
              disabled={pending || (item.grantLock !== null && state !== "grant")}
              title={item.grantLock ? t(LOCKS[item.grantLock]) : undefined}
              onClick={() => setState("grant")}
            >
              {t("Grant")}
            </button>
            <button
              type="button"
              data-active={state === "lock" ? "lock" : undefined}
              disabled={pending || (item.lockLock !== null && state !== "lock")}
              title={item.lockLock ? t(LOCKS[item.lockLock]) : undefined}
              onClick={() => setState("lock")}
            >
              {t("Lock")}
            </button>
          </span>
        ) : null}
        {lock ? <span className="perm-lock">{t(LOCKS[lock])}</span> : null}
      </div>
    );
  };

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>{t("Access")}</h2>
        <span className="reg-sub pd-num">
          {t("{n} of {total} permissions", { n: String(data.effectiveCount), total: String(data.total) })}
        </span>
      </div>

      {message ? <div className="notice" role="status" style={{ marginTop: 10 }}>{message}</div> : null}
      {error ? <div className="notice-error" role="alert" style={{ marginTop: 10 }}>{error}</div> : null}

      <h3 style={{ margin: "18px 0 8px" }}>{t("Roles")}</h3>
      <div className="role-chips">
        {data.held.map((role) => (
          <span key={role.id} className="role-chip">
            {name(role)}
            {role.canRemove ? (
              <button
                type="button"
                aria-label={t("Take the role {name} away?", { name: name(role) })}
                disabled={pending}
                onClick={() => take(role.id, name(role))}
              >
                ×
              </button>
            ) : (
              <span style={{ width: 6 }} />
            )}
          </span>
        ))}
        {data.defaultRole ? (
          <span className="role-chip" data-default="true" title={t("Applies while no role is given")}>
            {t("Default: {name}", { name: name(data.defaultRole) })}
          </span>
        ) : null}
        {!data.held.length && !data.defaultRole ? <span className="reg-sub">{t("No roles yet.")}</span> : null}
      </div>

      {data.canManage && data.assignable.length ? (
        <div className="form-row" style={{ alignItems: "flex-end", marginTop: 10 }}>
          <label style={{ flex: "1 1 220px" }}>
            <span className="field-label">{t("Give a role")}</span>
            <select className="input" value={picking} onChange={(e) => setPicking(e.target.value)}>
              <option value="">{t("Choose a role…")}</option>
              {data.assignable.map((role) => (
                <option key={role.id} value={role.id}>
                  {name(role)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-secondary" disabled={pending || !picking} onClick={give}>
            {pending ? <span className="spinner" /> : null}
            {t("Give role")}
          </button>
        </div>
      ) : null}

      <h3 style={{ margin: "22px 0 6px" }}>{t("What this person can do")}</h3>
      <p className="reg-sub" style={{ marginTop: 0 }}>
        {data.canOverride
          ? t("Inherit follows their roles. Grant adds one permission for this person only. Lock takes it away, and always wins.")
          : t("Worked out from their roles. Only BFT MENA can grant or lock single permissions.")}
      </p>
      <div className="form-row" style={{ alignItems: "flex-end" }}>
        <label style={{ flex: "1 1 240px" }}>
          <span className="field-label">{t("Search permissions")}</span>
          <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Score, waves, users…")} />
        </label>
        {data.canOverride ? (
          <button type="button" className="btn btn-primary" disabled={pending || !dirty} onClick={saveOverrides}>
            {pending ? <span className="spinner" /> : null}
            {t("Save access")}
          </button>
        ) : null}
      </div>

      <PermissionTree
        modules={data.modules}
        search={search}
        defaultOpen={false}
        moduleSummary={(module) => {
          const rows = module.screens.flatMap((screen) => screen.rows);
          return `${rows.filter((item) => item.effective).length}/${rows.length}`;
        }}
        screenSummary={(screen) => `${screen.rows.filter((item) => item.effective).length}/${screen.rows.length}`}
        screenActions={
          data.canOverride
            ? (screen) => (
                <>
                  <button
                    type="button"
                    className="chip-sm"
                    disabled={pending}
                    onClick={() =>
                      setStates((current) => {
                        const next = { ...current };
                        for (const item of screen.rows) next[item.key] = "inherit";
                        return next;
                      })
                    }
                  >
                    {t("Inherit all")}
                  </button>
                  <button
                    type="button"
                    className="chip-sm"
                    disabled={pending}
                    onClick={() =>
                      setStates((current) => {
                        const next = { ...current };
                        for (const item of screen.rows) if (item.lockLock === null) next[item.key] = "lock";
                        return next;
                      })
                    }
                  >
                    {t("Lock all")}
                  </button>
                </>
              )
            : undefined
        }
        renderRow={row}
      />
    </section>
  );
}
