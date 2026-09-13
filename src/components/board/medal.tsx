import { MEDALS } from "@/lib/scoring";

/** The ribbon-and-disc mark that precedes the top three in every list. */
export function Medal({ rank, size = 26 }: { rank: number; size?: number }) {
  const medal = MEDALS[rank];
  if (!medal) return null;

  return (
    <span
      aria-label={medal.label}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        flex: "none",
        marginInlineEnd: 9,
      }}
    >
      <span
        style={{
          width: Math.round(size * 0.62),
          height: Math.round(size * 0.34),
          background: medal.color,
          clipPath: "polygon(0 0,100% 0,72% 100%,28% 100%)",
          opacity: 0.85,
        }}
      />
      <span
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          marginTop: -2,
          borderRadius: "50%",
          background: `radial-gradient(circle at 34% 28%, ${medal.color} 0%, ${medal.color} 46%, rgba(35,31,32,0.28) 100%)`,
          boxShadow: "inset 0 0 0 1.5px rgba(35,31,32,0.35)",
          color: medal.ink,
          fontFamily: "var(--font-heading)",
          fontWeight: 600,
          fontSize: Math.round(size * 0.54),
          lineHeight: 1,
        }}
      >
        {rank}
      </span>
    </span>
  );
}
