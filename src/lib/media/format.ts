const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const pad2 = (n: number) => String(n).padStart(2, "0");

export function monthLabel(takenAt: string | null): string {
  if (!takenAt) return "Undated";
  const d = new Date(takenAt);
  return `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function monthKey(takenAt: string | null): string {
  if (!takenAt) return "undated";
  const d = new Date(takenAt);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${pad2(seconds)}`;
}

export function formatExposure(aperture: number | null, shutter: number | null): string {
  if (aperture === null && shutter === null) return "—";
  const apertureStr = aperture === null ? "—" : `ƒ/${aperture.toFixed(1)}`;
  const shutterStr =
    shutter === null ? "—" : shutter < 1 ? `1/${Math.round(1 / shutter)}s` : `${shutter}s`;
  return `${apertureStr} · ${shutterStr}`;
}

export function formatIsoFocal(iso: number | null, focal: number | null): string {
  if (iso === null && focal === null) return "—";
  const isoStr = iso === null ? "—" : `${iso}`;
  const focalStr = focal === null ? "—" : `${focal}mm`;
  return `${isoStr} · ${focalStr}`;
}

export function formatCoords(lat: number | null, lon: number | null): string {
  if (lat === null || lon === null) return "";
  const latHem = lat >= 0 ? "N" : "S";
  const lonHem = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}°${latHem} ${Math.abs(lon).toFixed(2)}°${lonHem}`;
}

export function formatTakenAt(iso: string | null): string {
  if (!iso) return "Unknown";
  const d = new Date(iso);
  const day = d.getUTCDate();
  const month = MONTHS_SHORT[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const hh = pad2(d.getUTCHours());
  const mm = pad2(d.getUTCMinutes());
  return `${day} ${month} ${year} · ${hh}:${mm}`;
}

export function formatDims(w: number | null, h: number | null): string {
  if (w === null || h === null) return "—";
  return `${w} × ${h}`;
}
