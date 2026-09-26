"use client";

import { useT } from "@/components/i18n/locale-provider";
import { formatQatarDateTime, formatQatarDayKey } from "@/lib/qatar-time";

// The two tables on the security screen: which browsers skip the emailed code,
// and what has happened on this account lately. Read-only apart from one
// button, so they are lifted out of the panel that owns the state.

export type Device = {
  id: string;
  deviceLabel: string | null;
  browser: string | null;
  os: string | null;
  deviceType: string | null;
  firstSeenAt: string;
  lastUsedAt: string;
  trustExpiresAt: string;
  lastIp: string | null;
};

export type SignInEvent = {
  id: string;
  eventType: string;
  browser: string | null;
  os: string | null;
  ip: string | null;
  isTrustedDevice: boolean;
  isSuspicious: boolean;
  createdAt: string;
};

/** "2026-10-03 09:20" — short, sortable, and the same in every locale. */
export function formatWhen(iso: string) {
  return formatQatarDateTime(iso);
}

export function DeviceTable({
  devices,
  loaded,
  pending,
  onRevoke,
}: {
  devices: Device[];
  loaded: boolean;
  pending: boolean;
  onRevoke: (deviceId: string) => void;
}) {
  const t = useT();

  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th>{t("Device")}</th>
            <th style={{ width: 140 }}>{t("Last used")}</th>
            <th style={{ width: 140 }}>{t("Trusted until")}</th>
            <th style={{ width: 130 }}>{t("Last IP")}</th>
            <th style={{ width: 120 }} />
          </tr>
        </thead>
        <tbody>
          {devices.map((device) => (
            <tr key={device.id}>
              <td style={{ fontFamily: "var(--font-heading)", fontWeight: 600 }}>
                {device.deviceLabel || `${device.os ?? "—"} · ${device.browser ?? "—"}`}
              </td>
              <td className="pd-num">{formatWhen(device.lastUsedAt)}</td>
              <td className="pd-num">{formatQatarDayKey(device.trustExpiresAt)}</td>
              <td className="pd-num" style={{ fontSize: 13 }}>
                {device.lastIp ?? "—"}
              </td>
              <td>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => onRevoke(device.id)}
                  disabled={pending}
                >
                  {t("Remove")}
                </button>
              </td>
            </tr>
          ))}
          {loaded && devices.length === 0 ? (
            <tr>
              <td colSpan={5} className="muted">
                {t("No trusted devices — every sign-in asks for a code.")}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export function ActivityTable({
  events,
  loaded,
}: {
  events: SignInEvent[];
  loaded: boolean;
}) {
  const t = useT();

  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 150 }}>{t("When")}</th>
            <th style={{ width: 170 }}>{t("Event")}</th>
            <th>{t("Device")}</th>
            <th style={{ width: 130 }}>{t("IP")}</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td className="pd-num">{formatWhen(event.createdAt)}</td>
              <td>
                <span
                  className={
                    event.eventType.includes("FAILED") || event.isSuspicious
                      ? "tag tag-outline-muted"
                      : "tag tag-outline"
                  }
                >
                  {event.eventType}
                </span>
              </td>
              <td style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                {[event.os, event.browser].filter(Boolean).join(" · ") || "—"}
              </td>
              <td className="pd-num" style={{ fontSize: 13 }}>
                {event.ip ?? "—"}
              </td>
            </tr>
          ))}
          {loaded && events.length === 0 ? (
            <tr>
              <td colSpan={4} className="muted">
                {t("Nothing recorded yet.")}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
