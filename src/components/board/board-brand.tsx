import Image from "next/image";

/**
 * The lockup at the head of every board: the PODIUM wordmark, a hairline, and
 * BFT MENA. This is the MENA build — the mark reads "by BFT MENA", never
 * "by BFT" alone.
 */
export function BoardBrand({
  size = "lg",
  align = "center",
}: {
  size?: "sm" | "md" | "lg";
  align?: "center" | "start";
}) {
  const height = size === "lg" ? 26 : size === "md" ? 20 : 16;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "flex-start",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "clamp(12px,2vw,20px)" }}>
        <Image
          src="/brand/podium-light-on-dark.png"
          alt="PODIUM"
          width={Math.round(height * 3.48)}
          height={height}
          style={{ height, width: "auto" }}
          priority
        />
        <span
          aria-hidden
          style={{
            width: 1,
            height: Math.round(height * 0.8),
            background: "rgba(255,255,255,0.22)",
          }}
        />
        <Image
          src="/brand/bft-light-on-dark.png"
          alt="BFT MENA"
          width={Math.round(height * 0.86 * 1.28)}
          height={Math.round(height * 0.86)}
          style={{ height: Math.round(height * 0.86), width: "auto" }}
          priority
        />
      </div>
    </div>
  );
}

/**
 * The public face of the brand: the PODIUM wordmark centered with "BY BFT
 * MENA" set beneath it, the way the reference results screen stacks them.
 * Dark-ground artwork — published results are always the dark board world.
 */
export function PublicBrand({ height = 50 }: { height?: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 7,
      }}
    >
      <Image
        src="/brand/podium-light-on-dark.png"
        alt="PODIUM"
        width={Math.round(height * 3.48)}
        height={height}
        style={{ height, width: "auto" }}
        priority
      />
      <div
        style={{
          fontFamily: "var(--font-heading), sans-serif",
          fontWeight: 700,
          fontSize: 10,
          letterSpacing: "0.46em",
          textIndent: "0.46em",
          textTransform: "uppercase",
          color: "var(--board-text-muted)",
        }}
      >
        BY BFT MENA
      </div>
    </div>
  );
}

/** "Powered by BFT MENA", the line that sits under the lockup. */
export function PoweredBy({
  tone = "dark",
  label = "Powered by BFT MENA",
}: {
  /** dark = the board/public ground, navy = the sign-in shell, light = themed. */
  tone?: "dark" | "navy" | "light";
  label?: string;
}) {
  const color =
    tone === "navy"
      ? "var(--color-accent-300)"
      : tone === "dark"
        ? "var(--board-text-muted)"
        : "var(--text-muted)";

  return (
    <div
      style={{
        fontFamily: "var(--font-heading), sans-serif",
        fontWeight: 700,
        fontSize: 10,
        letterSpacing: "0.3em",
        textTransform: "uppercase",
        color,
      }}
    >
      {label}
    </div>
  );
}
