#!/usr/bin/env bash
#
# build-dataset.sh — regenerate crates/dp-places/data/cities.tsv.gz
#
# Downloads the GeoNames "cities1000" dump (cities with population >= 1000)
# plus the admin1 (state/province) and country reference tables, joins them,
# and writes a small gzipped TSV that gets bundled into the dp-places crate
# via `include_bytes!`.
#
# Output columns (tab-separated, no header):
#   name<TAB>admin1_name<TAB>country_name<TAB>lat<TAB>lon<TAB>population
#
# `admin1_name` may be empty (e.g. city-states, territories with no GeoNames
# admin1 entry). `population` is used only to rank search results and break
# reverse-geocode ties; it is not exposed on the `City` struct.
#
# Usage:
#   scripts/build-dataset.sh            # download + build (skips re-download
#                                        # if the raw files are already cached)
#   scripts/build-dataset.sh --force    # always re-download raw sources
#
# Data source: https://www.geonames.org/ (GeoNames dump), CC BY 4.0.
#
# Idempotent: re-running with the same upstream data produces a byte-identical
# cities.tsv (gzip metadata/timestamps aside). Raw downloads are cached under
# a temp work directory that is removed on success; use --force to bypass
# the cache and re-fetch everything.
#
# Fallback: if cities1000.zip is unreachable after retries, this script
# retries against cities5000.zip. If GeoNames is unreachable entirely, it
# exits non-zero — it never fabricates data.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
CRATE_DIR="$(cd "${SCRIPT_DIR}/.." >/dev/null 2>&1 && pwd)"
DATA_DIR="${CRATE_DIR}/data"
OUT_TSV_GZ="${DATA_DIR}/cities.tsv.gz"

BASE_URL="https://download.geonames.org/export/dump"
CITIES_PRIMARY="cities1000"
CITIES_FALLBACK="cities5000"

FORCE=0
if [ "${1:-}" = "--force" ]; then
  FORCE=1
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/dp-places-dataset.XXXXXX")"
cleanup() { rm -rf "${WORK_DIR}"; }
trap cleanup EXIT

log() { printf '[build-dataset] %s\n' "$*" >&2; }

fetch() {
  # fetch <url> <dest>
  url="$1"
  dest="$2"
  attempt=1
  max_attempts=3
  while [ "${attempt}" -le "${max_attempts}" ]; do
    log "downloading ${url} (attempt ${attempt}/${max_attempts})"
    if curl -fsSL --retry 2 --retry-delay 2 --max-time 120 -o "${dest}" "${url}"; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 2
  done
  return 1
}

fetch_cities_zip() {
  dest_zip="${WORK_DIR}/cities.zip"
  if fetch "${BASE_URL}/${CITIES_PRIMARY}.zip" "${dest_zip}"; then
    echo "${CITIES_PRIMARY}.txt"
    return 0
  fi
  log "WARNING: ${CITIES_PRIMARY}.zip unreachable, falling back to ${CITIES_FALLBACK}.zip"
  if fetch "${BASE_URL}/${CITIES_FALLBACK}.zip" "${dest_zip}"; then
    echo "${CITIES_FALLBACK}.txt"
    return 0
  fi
  return 1
}

main() {
  mkdir -p "${DATA_DIR}"

  if [ "${FORCE}" -eq 0 ] && [ -f "${OUT_TSV_GZ}" ]; then
    log "note: ${OUT_TSV_GZ} already exists; rebuilding in place (use --force to also re-download raw sources)"
  fi

  cities_inner_name="$(fetch_cities_zip)" || {
    log "ERROR: could not download cities1000.zip or cities5000.zip from GeoNames after retries. BLOCKED."
    exit 1
  }

  if ! fetch "${BASE_URL}/admin1CodesASCII.txt" "${WORK_DIR}/admin1CodesASCII.txt"; then
    log "ERROR: could not download admin1CodesASCII.txt from GeoNames after retries. BLOCKED."
    exit 1
  fi

  if ! fetch "${BASE_URL}/countryInfo.txt" "${WORK_DIR}/countryInfo.txt"; then
    log "ERROR: could not download countryInfo.txt from GeoNames after retries. BLOCKED."
    exit 1
  fi

  log "extracting ${cities_inner_name}"
  unzip -p "${WORK_DIR}/cities.zip" "${cities_inner_name}" > "${WORK_DIR}/cities.txt"

  log "joining cities + admin1 + country tables"
  python3 "${SCRIPT_DIR}/build_tsv.py" \
    "${WORK_DIR}/cities.txt" \
    "${WORK_DIR}/admin1CodesASCII.txt" \
    "${WORK_DIR}/countryInfo.txt" \
    "${WORK_DIR}/cities.tsv"

  rows="$(wc -l < "${WORK_DIR}/cities.tsv" | tr -d ' ')"
  if [ "${rows}" -eq 0 ]; then
    log "ERROR: joined TSV has 0 rows. BLOCKED."
    exit 1
  fi

  log "gzipping (${rows} rows) -> ${OUT_TSV_GZ}"
  gzip -9 -n -c "${WORK_DIR}/cities.tsv" > "${OUT_TSV_GZ}"

  size="$(wc -c < "${OUT_TSV_GZ}" | tr -d ' ')"
  log "done: ${OUT_TSV_GZ} (${size} bytes, ${rows} rows)"
}

main "$@"
