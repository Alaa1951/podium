import { getNotificationUser, listNotifications } from "@/lib/notifications";

export async function GET(request: Request) {
  const user = await getNotificationUser();
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  if (!user) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers });
  const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
  if (cursor && cursor.length > 191) return Response.json({ error: "INVALID_CURSOR" }, { status: 400, headers });
  const feed = await listNotifications(user, cursor);
  if (!feed) return Response.json({ error: "INVALID_CURSOR" }, { status: 400, headers });
  return Response.json(feed, { headers });
}
