"use client";

// The small pieces of the score sheet: a labelled field, a zone's footer, and
// the two styles the dark totals bar is drawn with.

export const numberInput: React.CSSProperties = { width: 96, fontSize: 18, textAlign: "end" };

export const darkLabel: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "rgba(242,242,243,0.7)",
};

export const darkValue: React.CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontWeight: 600,
  fontSize: 46,
  lineHeight: 1,
};

export function Row({
  label,
  unit,
  children,
}: {
  label: string;
  unit: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
      <span style={{ flex: 1, fontSize: 13, color: "var(--text-secondary)" }}>
        {label}
        {unit ? <span style={{ color: "var(--text-muted)" }}> ({unit})</span> : null}
      </span>
      {children}
    </label>
  );
}

export function Footer({ left, right }: { left: string; right: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        marginTop: 10,
        paddingTop: 8,
        borderTop: "1px solid var(--border)",
        fontSize: 12,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "var(--text-muted)",
      }}
    >
      <span className="pd-num">{left}</span>
      <span
        className="pd-num"
        style={{ fontFamily: "var(--font-heading)", fontSize: 20, color: "var(--text)" }}
      >
        {right}
      </span>
    </div>
  );
}
