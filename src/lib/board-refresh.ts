/** Serialize pulls; a notification during a pull always gets a later fresh read. */
export function createBoardRefresh<T>(load: () => Promise<T | null>, onData: (data: T) => void) {
  let active = true;
  let running = false;
  let requested = false;

  return {
    async refresh() {
      requested = true;
      if (running || !active) return;
      running = true;
      try {
        do {
          requested = false;
          try {
            const data = await load();
            if (active && data !== null) onData(data);
          } catch {
            // Keep the last payload on a network failure. The next event or
            // normal poll will retry it.
          }
        } while (active && requested);
      } finally {
        running = false;
      }
    },
    stop() { active = false; },
  };
}
