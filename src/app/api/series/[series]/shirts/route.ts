import { NextResponse } from "next/server";

import { AUDIT, recordAudit } from "@/lib/audit";
import { getSeries } from "@/lib/queries";
import { canAny, getCurrentUser, teamScope } from "@/lib/session";
import { getShirtSeats } from "@/lib/shirt-report";

export const dynamic = "force-dynamic";

// The T-shirt list, one line per athlete: for the printer's order and for the
// hand-out table on the day (sorted by wave and station, the order athletes
// arrive in). Names, team, gym and size only — no contact details. Scoped
// like every other read, and every download is in the audit log.

/** RFC 4180: quote everything, double any embedded quote. */
function cell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(_req: Request, ctx: RouteContext<"/api/series/[series]/shirts">) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (user.role === "competitor" || !canAny(user, ["shirts.view", "registrations.view"])) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { series } = await ctx.params;
  const competition = await getSeries(series);
  if (!competition) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const seats = await getShirtSeats(competition.id, teamScope(user));
  const ordered = [...seats].sort(
    (a, b) =>
      Number(a.waitlisted) - Number(b.waitlisted) ||
      (a.waveNumber ?? 999) - (b.waveNumber ?? 999) ||
      (a.station ?? 99) - (b.station ?? 99) ||
      a.teamNumber - b.teamNumber
  );

  const header = ["wave", "station", "team_number", "team_name", "athlete", "size", "gym", "category", "division", "waiting_list"];
  const rows = ordered.map((seat) =>
    [
      seat.waveNumber ?? "",
      seat.station ?? "",
      seat.teamNumber,
      seat.teamName,
      seat.athlete,
      seat.size ?? "",
      seat.studio ?? "",
      seat.category,
      seat.division,
      seat.waitlisted ? "yes" : "",
    ]
      .map(cell)
      .join(",")
  );
  const csv = [header.map(cell).join(","), ...rows].join("\r\n");

  await recordAudit({
    actorId: user.id,
    action: AUDIT.rosterExported,
    targetType: "event",
    targetId: competition.id,
    detail: `t-shirts · ${seats.length} athletes`,
  });

  const slug = competition.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return new NextResponse(`﻿${csv}`, {
    headers: {
      // The BOM keeps Excel from mangling names on a Windows machine.
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="podium-${slug || "event"}-tshirts.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
