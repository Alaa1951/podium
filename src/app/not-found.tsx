import Link from "next/link";

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
        background: "var(--color-accent-900)",
        color: "var(--on-navy)",
      }}
    >
      <div style={{ maxWidth: 460, textAlign: "center" }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "var(--color-accent-300)",
          }}
        >
          PODIUM
        </div>
        <h1
          className="pd-num"
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 600,
            fontSize: "clamp(64px,14vw,160px)",
            lineHeight: 0.9,
            margin: "6px 0 4px",
          }}
        >
          404
        </h1>
        <p style={{ fontSize: 14, color: "var(--on-navy-secondary)" }}>
          That screen does not exist — or it belongs to an event or a team this account cannot
          see.
        </p>
        <Link href="/" className="btn btn-cyan" style={{ marginTop: 18, textDecoration: "none" }}>
          Back to the start
        </Link>
      </div>
    </div>
  );
}
