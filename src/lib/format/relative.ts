const MINUTE = 60;
const HOUR = MINUTE * 60;
const DAY = HOUR * 24;

/** Formats `iso` as a short relative time (e.g. "2 min ago") relative to `now`. */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";

  const diffSeconds = Math.max(0, Math.floor((now - then) / 1000));

  if (diffSeconds < MINUTE) return "just now";

  if (diffSeconds < HOUR) {
    const minutes = Math.floor(diffSeconds / MINUTE);
    return `${minutes} min ago`;
  }

  if (diffSeconds < DAY) {
    const hours = Math.floor(diffSeconds / HOUR);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  const days = Math.floor(diffSeconds / DAY);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
