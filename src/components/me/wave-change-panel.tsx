import { WaveChangeForm } from "@/components/me/wave-change-form";
import { teamWaveChangeHistory } from "@/lib/wave-change-requests";
import { SheetRefresher } from "@/components/floor/sheet-refresher";

export async function WaveChangePanel({ teamId, userId, eligible, readOnly }: {
  teamId: string; userId: string; eligible: boolean; readOnly: boolean;
}) {
  const requests = await teamWaveChangeHistory(teamId, userId);
  return <><SheetRefresher seconds={30} /><WaveChangeForm teamId={teamId} eligible={eligible} readOnly={readOnly} requests={requests} /></>;
}
