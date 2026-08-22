const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B`;
  let i = 0;
  let v = n;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  const s = v >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, "");
  return `${s} ${UNITS[i]}`;
}
