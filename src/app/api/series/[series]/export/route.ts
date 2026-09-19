import { NextResponse } from "next/server";

import { getSeries, getSeriesZones, getScopedTeams } from "@/lib/queries";
import { can, getCurrentUser } from "@/lib/session";
import { allInputs, zonePoints } from "@/lib/zones";

export const dynamic = "force-dynamic";

// The paper backup, in a file.
//
// The columns are not a list written here — they are built from the series'
// own zone definition, so a series with three zones or six exports correctly
// without this file knowing anything about the movements. Raw values come
// first so the file can be re-imported or re-scored; derived points follow for
// reading. Scoped like every other read: a studio exports its own teams.

/** A column name a spreadsheet will not fight you over. */
function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** RFC 4180: quote everything, double any embedded quote. */
function cell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(_req: Request, ctx: RouteContext<"/api/series/[series]/export">) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!can(user, "registrations.export")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { series } = await ctx.params;
  const competition = await getSeries(series);
  if (!competition) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const [teams, zones] = await Promise.all([
    getScopedTeams(competition.id, user),
    getSeriesZones(competition.id),
  ]);
  const inputs = allInputs(zones);

  const header = [
    "team_number",
    "team_name",
    "category",
    "division",
    "wave",
    "studio",
    // Registration and payment travel with the team, because an export is
    // usually what somebody reconciles the money against.
    "payment_status",
    "registered_at",
    "paid_at",
    "amount",
    "currency",
    "billing_number",
    "source",
    "attended",
    "competitor_1",
    "competitor_1_phone",
    "competitor_1_email",
    "competitor_1_studio",
    "competitor_2",
    "competitor_2_phone",
    "competitor_2_email",
    "competitor_2_studio",
    // One raw column per movement, then one points column per zone.
    ...inputs.map((input) => `z${input.zone.number}_${slugify(input.label)}`),
    ...zones.map((zone) => `z${zone.number}_points`),
    "total",
    "status",
  ];

  const iso = (date: Date | null) => (date ? date.toISOString() : "");

  const rows = teams.map((team) => {
    const [first, second] = team.competitors;
    return [
      team.number,
      team.name,
      team.category,
      team.division,
      team.wave,
      team.studioName ?? "non-member",
      team.paymentStatus,
      iso(team.registeredAt),
      iso(team.paidAt),
      team.amountMinor === null ? "" : (team.amountMinor / 100).toFixed(2),
      team.currency,
      team.billingNumber ?? "",
      team.source,
      team.attendedAt ? "yes" : "no",
      first?.fullName ?? "",
      first?.phone ?? "",
      first?.email ?? "",
      first?.studioName ?? "non-member",
      second?.fullName ?? "",
      second?.phone ?? "",
      second?.email ?? "",
      second?.studioName ?? "non-member",
      ...inputs.map((input) => team.values[input.id] ?? ""),
      ...zones.map((zone) => zonePoints(zone, team.values)),
      team.total,
      team.submitted ? "submitted" : "draft",
    ]
      .map(cell)
      .join(",");
  });

  const csv = [header.map(cell).join(","), ...rows].join("\r\n");
  const slug = competition.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  return new NextResponse(`﻿${csv}`, {
    headers: {
      // The BOM keeps Excel from mangling names on a Windows machine.
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="podium-${slug || "event"}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
