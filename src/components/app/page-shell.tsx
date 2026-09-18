import type { ReactNode } from "react";

/** The standard console page: eyebrow, big title, rule, then content. */
export function PageShell({
  eyebrow,
  title,
  blurb,
  actions,
  width = 1000,
  children,
}: {
  eyebrow?: string;
  title: string;
  blurb?: string;
  actions?: ReactNode;
  width?: number;
  children: ReactNode;
}) {
  return (
    <div className="page-shell" style={{ maxWidth: width, margin: "0 auto", padding: "34px 28px 80px" }}>
      <div className="page-head">
        {eyebrow ? <div className="page-eyebrow">{eyebrow}</div> : null}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <h1 className="page-title">{title}</h1>
          {actions ? <div style={{ marginInlineStart: "auto" }}>{actions}</div> : null}
        </div>
        {blurb ? <p className="page-sub">{blurb}</p> : null}
      </div>
      {children}
    </div>
  );
}

/** A plain card. The registration marks it was named for are long gone. */
export function BlueprintCard({
  children,
  style,
}: {
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className="card blueprint" style={style}>
      {children}
    </div>
  );
}
