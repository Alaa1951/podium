"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { grantWaveAccess, revokeWaveAccess } from "@/lib/actions/wave-access";

/**
 * WHO SCORES WHICH WAVE.
 *
 * One grant = one account + one wave: that account's home becomes the score
 * sheet of exactly that wave — for a judge or recorder at a specific location,
 * several of which may be scoring at the same moment. Nothing else of the
 * console opens for them.
 */
export function WaveAccessCard({
  waves,
  accounts,
  grants,
}: {
  waves: { id: string; number: number }[];
  accounts: { id: string; email: string; name: string | null }[];
  grants: { id: string; waveNumber: number; email: string; name: string | null }[];
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [userId, setUserId] = useState("");
  const [waveId, setWaveId] = useState(waves[0]?.id ?? "");

  function grant() {
    setMessage("");
    if (!userId || !waveId) return;
    startTransition(async () => {
      const result = await grantWaveAccess({ userId, waveId });
      if (!result.ok) {
        setMessage(
          result.error === "ALREADY_GRANTED"
            ? t("That account already has this wave.")
            : t("Something went wrong. Try again.")
        );
        return;
      }
      setMessage(result.message ?? "");
      router.refresh();
    });
  }

  function revoke(accessId: string) {
    setMessage("");
    startTransition(async () => {
      const result = await revokeWaveAccess({ accessId });
      if (!result.ok) setMessage(t("Something went wrong. Try again."));
      else router.refresh();
    });
  }

  return (
    <div className="card" style={{ marginTop: 26 }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>
        {t("Wave access")}
      </h2>
      <p className="reg-sub" style={{ marginTop: 4, marginBottom: 12 }}>
        {t(
          "Give an account the score sheet of one wave — it opens straight onto that sheet and nothing else. Several waves can run at once, each with its own people."
        )}
      </p>

      {message ? (
        <div className="notice" role="status" style={{ marginBottom: 12 }}>
          {message}
        </div>
      ) : null}

      <div className="form-row" style={{ alignItems: "flex-end" }}>
        <Field label={t("Account")}>
          <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">{t("Choose an account…")}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name ? `${account.name} — ` : ""}
                {account.email}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("Wave")}>
          <select className="input" value={waveId} onChange={(e) => setWaveId(e.target.value)}>
            {waves.map((wave) => (
              <option key={wave.id} value={wave.id}>
                {t("Wave")} {wave.number}
              </option>
            ))}
          </select>
        </Field>

        <button
          type="button"
          className="btn btn-primary"
          disabled={pending || !userId || !waveId}
          onClick={grant}
        >
          {pending ? <span className="spinner" /> : null}
          {t("Grant access")}
        </button>
      </div>

      {grants.length === 0 ? (
        <p className="reg-sub" style={{ margin: "10px 0 0" }}>
          {t("No wave access granted yet.")}
        </p>
      ) : (
        <div className="table-scroll" style={{ marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 90 }}>{t("Wave")}</th>
                <th>{t("Account")}</th>
                <th style={{ width: 110 }} />
              </tr>
            </thead>
            <tbody>
              {grants
                .slice()
                .sort((a, b) => a.waveNumber - b.waveNumber || a.email.localeCompare(b.email))
                .map((one) => (
                  <tr key={one.id}>
                    <td className="pd-num">{one.waveNumber}</td>
                    <td>{one.email}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        disabled={pending}
                        onClick={() => revoke(one.id)}
                      >
                        {t("Revoke")}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block", flex: "1 1 220px", minWidth: 0 }}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}
