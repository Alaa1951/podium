import { WaiverPromptBar } from "@/components/waivers/waiver-prompt-bar";
import { getTranslator } from "@/lib/i18n/server";
import { pendingWaivers } from "@/lib/waivers/my-waivers";

/**
 * Above every screen, for anybody with a seat whose waiver still needs their
 * signature — an athlete, or staff who also compete. A prompt, never a
 * redirect: sign-in, sign-out, Account and the waiver page itself are always
 * reachable.
 */
export async function WaiverPrompt({ userId }: { userId: string }) {
  const pending = await pendingWaivers(userId);
  if (!pending.length) return null;
  const { t } = await getTranslator();
  const first = pending[0];
  const text = pending.length === 1
    ? t(first.state === "resign" ? "Your waiver for {competition} needs signing again." : "Waiver acceptance required for {competition}.", { competition: first.series.name })
    : t("{count} waivers need your signature.", { count: pending.length });
  return <WaiverPromptBar href={`/waivers?series=${encodeURIComponent(first.series.id)}`} text={text} action={t("Read and sign")} />;
}
