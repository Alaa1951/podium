import Image from "next/image";

/**
 * The PODIUM wordmark and the BFT MENA mark, over the hairline divider that
 * separates them throughout the reference design.
 *
 * tone="light" | "dark" picks the artwork outright — for grounds that never
 * move (the sign-in shell, the board). tone="auto" renders both variants and
 * lets CSS pick with the theme, for surfaces that follow it (the console
 * sidebar): inverting one PNG would shift its colour and is not a thing to do
 * to somebody's logo. Lazy loading also lets CSS-hidden variants stay unfetched;
 * eager loading or preloading would download both themes and hidden sidebars.
 */
export function PodiumMark({
  tone = "light",
  height = 44,
}: {
  tone?: "light" | "dark" | "auto";
  height?: number;
}) {
  if (tone === "auto") {
    return (
      <>
        <span className="mark-on-light">
          <PodiumMark tone="light" height={height} />
        </span>
        <span className="mark-on-dark">
          <PodiumMark tone="dark" height={height} />
        </span>
      </>
    );
  }

  const dark = tone === "dark";
  const podium = dark ? "/brand/podium-light-on-dark.png" : "/brand/podium-dark-on-light.png";
  const bft = dark ? "/brand/bft-light-on-dark.png" : "/brand/bft-dark-on-light.png";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <Image
        src={podium}
        alt="PODIUM"
        width={Math.round(height * 3.48)}
        height={height}
        style={{ height, width: "auto" }}
        loading="lazy"
      />
      <span
        style={{
          width: 1,
          height: Math.round(height * 0.77),
          background: dark ? "rgba(242,242,243,0.4)" : "var(--border-strong)",
        }}
      />
      <Image
        src={bft}
        alt="BFT MENA"
        width={Math.round(height * 0.82 * 1.28)}
        height={Math.round(height * 0.82)}
        style={{ height: Math.round(height * 0.82), width: "auto" }}
        loading="lazy"
      />
    </div>
  );
}
