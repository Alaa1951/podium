// THE PODIUM SERVICE WORKER — install support and the offline fallback only.
//
// Take over immediately instead of waiting for every tab to close. All logic
// lives in THIS file, so an edit reaches a screen that stays open for days
// (the wall board) without a manual reload. This is safe because the worker
// handles only `install`, `activate`, `push`-less navigation fallback and
// notificationclick — it CACHES NOTHING, so there is no page/worker version
// skew a new worker could create.
//
// NARROW ON PURPOSE, and every clause is load-bearing:
//   - GET navigations only, so form posts, API calls, images and scripts are
//     never routed through here;
//   - the network is always tried FIRST and its response returned untouched,
//     so a working connection behaves exactly as with no worker at all;
//   - the fallback is generated, not cached — no CacheStorage, no app shell.
//
// iOS does not need any of this to add a web app to the Home Screen; Apple's
// path has no service-worker requirement. This is for the offline experience
// and for Chromium's one-tap install.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// GET navigations only — never API calls, never assets.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.mode !== "navigate") return;
  event.respondWith(
    fetch(request).catch(
      () =>
        new Response(
          `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PODIUM — offline</title>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#07070d;color:#f2f2f3;font-family:system-ui,sans-serif;text-align:center;padding:24px">
<div>
<div style="font-size:12px;letter-spacing:.3em;color:#00b5cc;margin-bottom:12px">PODIUM · BFT MENA</div>
<h1 style="font-size:22px;margin:0 0 10px">You are offline</h1>
<p style="color:#85879a;margin:0 0 18px">الشبكة مقطوعة — شوف النت وجرب تاني</p>
<button onclick="location.reload()" style="background:#00b5cc;color:#04212a;border:0;border-radius:6px;padding:10px 22px;font-weight:700;cursor:pointer">Try again</button>
</div>
</body></html>`,
          {
            status: 503,
            headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
          }
        )
    )
  );
});
