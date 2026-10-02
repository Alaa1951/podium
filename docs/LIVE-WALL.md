# The venue wall — `/live/[series]`

The public live-board links for the room's projector screens. No sign-in, no
menu, no browser chrome of ours — the board is the whole page, and it takes the
whole display.

---

## The links

One pair of links per competition, built from the competition's slug — the same
slug its board and console URLs already use:

```
https://<domain>/live/<competition-slug>            live board 1
https://<domain>/live/<competition-slug>?board=2    live board 2
```

**Live board 1** is the main board — what the signed-in board shows while the
event runs: the wave clock, progress, the ranking's pages turning, the floor.

**Live board 2** is the floor itself — a map of the room, and deliberately a
different screen from board 1: one column per zone (the event's own zones,
in order), each column listing its stations top to bottom, and on every
station the team standing there right now — its competitors under the team
name, the wave it came with, and its running total. The chip on each zone
names the wave the zone is working with; when a wave finishes and the next
one starts behind it, the map changes with them on the next poll. The room
reads it the way the room is built: find your zone, walk to your station.

Open a link on the venue PC and click anywhere once (or press any key): the
page enters full screen — no address bar, no Windows taskbar. The small
"click anywhere for full screen" hint at the bottom disappears once the screen
is edge to edge, and comes back if the browser ever leaves full screen, so one
click always puts it back.

For a setup that never shows Windows at all — boots straight into the board —
use a kiosk shortcut instead (below).

## What they show

The walls follow the event, not whoever opens them:

| Event state                     | Both boards show                                      |
| ------------------------------- | ----------------------------------------------------- |
| Before the doors open           | The countdown; no team data                           |
| Event running                   | Board 1: the main board · Board 2: the floor, 10s turn |
| Finished, results not published | "Results soon" hold                                   |
| Results published               | The published leaderboard                             |

A wall never has to be touched between these: the screen polls the phase and
reloads itself when it moves (scores themselves refresh every ten seconds, the
same as the signed-in board).

## Inside the app

The same two boards exist for signed-in accounts, under the signed-in access
rules — from the competition page's **Live board 1** / **Live board 2** buttons,
from the board's own switcher (top bar), or directly:

```
/series/<slug>/board            live board 1
/series/<slug>/board?board=2    live board 2
```

BFT MENA can rehearse either one before the doors open with `?preview=1`.

## Venue PC setup

**Quick (any browser):** open the link, click once. Done — full screen until
someone presses `Esc` or `F11`.

**Permanent (kiosk) — Windows, Chrome:**

1. Right-click the desktop → **New → Shortcut**.
2. Target:

   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --new-window "https://<domain>/live/<slug>"
   ```

3. Name it **Wall — Board 1** (make a second one with `?board=2`, named
   **Wall — Board 2**).

Kiosk mode starts Chrome with no address bar, no tabs and no taskbar — the
board is the whole screen from the moment Windows boots into it. Put the
shortcuts in `shell:startup` (Win+R → `shell:startup`) and both walls come up
by themselves after a reboot.

**Edge**, if Chrome is not installed:

```
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --kiosk "https://<domain>/live/<slug>" --edge-kiosk-type=fullscreen
```

**Notes**

- The page asks the display to stay awake (Screen Wake Lock), but check the
  venue PC's own power plan once before the day: set *turn off display* and
  *screen saver* to Never.
- The screen needs the same network access the venue phones have — it polls
  the same endpoints.
- The wall URLs are public by design: during the event anyone with them sees
  the live board. Before the event they carry no team data, and the final
  ranking stays hidden until results are published.

---

## How it works (for maintainers)

- Page: `src/app/(wall)/live/[series]/page.tsx` — no account, gated by
  `wallView(phase)` in `visibility.ts` (tested in `visibility.test.ts`).
  `?board=2` picks the floor-only dashboard; every other value is board 1.
- Shell: `src/components/board/wall-shell.tsx` — full screen on first gesture,
  wake lock, phase poll → reload.
- APIs: `/api/live/[series]/board` (the payload, phase-gated, shared build
  cache with the signed-in board's poll) and `/api/live/[series]/status`
  (the phase, for the reload-on-change poll).
- Floor mode: `src/components/board/floor-board.tsx` — the zone map. Zones
  come from the event's own zone definitions; the station count follows the
  floor (six or more, from the teams standing). Which wave sits in which zone
  is the floor schedule's answer (`lib/floor.ts`), re-read on every poll.
- The signed-in board and its poll are otherwise unchanged; the board
  components take an optional `pollHref` so the wall can poll its own gate.
