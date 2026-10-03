import "server-only";

import { boardRevision, subscribeBoardChanges } from "@/lib/board-events";

/** A notification carries no score data; the existing gated board API serves it. */
export function boardEventResponse(request: Request, seriesId: string) {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const timers: { heartbeat?: ReturnType<typeof setInterval>; lifetime?: ReturnType<typeof setTimeout> } = {};
      let unsubscribe = () => {};
      const finish = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(timers.heartbeat);
        clearTimeout(timers.lifetime);
        request.signal.removeEventListener("abort", finish);
        try { controller.close(); } catch { /* The reader may have cancelled first. */ }
      };
      cleanup = finish;
      const send = (text: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(text)); } catch { finish(); }
      };
      const changed = (revision: number) => send(`event: board\ndata: ${revision}\n\n`);
      unsubscribe = subscribeBoardChanges(seriesId, changed);
      request.signal.addEventListener("abort", finish, { once: true });
      if (request.signal.aborted) { finish(); return; }

      // Also refresh on reconnect: a save may have happened while disconnected.
      send("retry: 1000\n\n");
      changed(boardRevision(seriesId));
      timers.heartbeat = setInterval(() => send(": keepalive\n\n"), 15_000);
      // Reconnect through the route so account access and event phase are read
      // again. The stream never keeps a previously authorised session forever.
      timers.lifetime = setTimeout(finish, 60_000);
    },
    cancel() { cleanup(); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
