#!/usr/bin/env python3
"""Join GeoNames cities/admin1/country dumps into the dp-places TSV format.

Invoked by build-dataset.sh; not meant to be run standalone against
untrusted input. Output columns (no header, tab-separated):

    name  admin1_name  country_name  lat  lon  population

`admin1_name` is empty when the city's (country, admin1_code) pair has no
matching row in admin1CodesASCII.txt. Rows with unparsable lat/lon are
skipped.

Rows are also skipped when their GeoNames feature code marks them as a
sub-city section/neighborhood (PPLX, e.g. "Paris 04 Hotel-de-Ville", an
arrondissement) or as no-longer-current (historical/abandoned/destroyed:
PPLH, PPLCH, PPLQ, PPLW). Those exist in the GeoNames "cities1000" dump
because population alone gates inclusion, but they are not the kind of
place a reverse-geocoder should report as "the nearest city" — a point
inside a neighborhood should resolve to its parent city, not the
neighborhood itself.
"""

import csv
import sys

EXCLUDED_FEATURE_CODES = {
    "PPLX",  # section of populated place (neighborhood/arrondissement)
    "PPLH",  # historical populated place
    "PPLCH",  # historical capital
    "PPLQ",  # abandoned populated place
    "PPLW",  # destroyed populated place
}


def load_admin1(path):
    """code (e.g. 'US.CA') -> name"""
    table = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            code, name = parts[0], parts[1]
            table[code] = name
    return table


def load_countries(path):
    """ISO alpha-2 -> country name"""
    table = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("#") or not line.strip():
                continue
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 5:
                continue
            iso, name = parts[0], parts[4]
            table[iso] = name
    return table


def main():
    if len(sys.argv) != 5:
        print(
            "usage: build_tsv.py <cities.txt> <admin1CodesASCII.txt> "
            "<countryInfo.txt> <out.tsv>",
            file=sys.stderr,
        )
        return 2

    cities_path, admin1_path, country_path, out_path = sys.argv[1:5]

    admin1 = load_admin1(admin1_path)
    countries = load_countries(country_path)

    written = 0
    skipped = 0
    with open(cities_path, encoding="utf-8") as fin, open(
        out_path, "w", encoding="utf-8", newline=""
    ) as fout:
        writer = csv.writer(fout, delimiter="\t", lineterminator="\n")
        reader = csv.reader(fin, delimiter="\t")
        for row in reader:
            if len(row) < 15:
                skipped += 1
                continue
            name = row[1]
            lat_s = row[4]
            lon_s = row[5]
            feature_code = row[7]
            country_code = row[8]
            admin1_code = row[10]
            population_s = row[14]

            if feature_code in EXCLUDED_FEATURE_CODES:
                skipped += 1
                continue

            try:
                lat = float(lat_s)
                lon = float(lon_s)
            except ValueError:
                skipped += 1
                continue

            # Deliberate fallback, not a fail-loud case: `population` is only
            # ever used at runtime to rank/tie-break, never to accept or
            # reject a row (unlike lat/lon or name, which are load-bearing
            # and cause a skip above). GeoNames' documented population field
            # defaults to "0" for unknown, so an unparseable value here would
            # be an upstream format change we still don't want to lose an
            # otherwise-valid city row over -- default to 0 (lowest ranking
            # preference) and keep the row.
            try:
                population = int(population_s)
            except ValueError:
                population = 0

            if not name:
                skipped += 1
                continue

            country_name = countries.get(country_code, "")
            admin1_name = admin1.get(f"{country_code}.{admin1_code}", "")

            writer.writerow(
                [name, admin1_name, country_name, repr(lat), repr(lon), population]
            )
            written += 1

    print(f"[build_tsv.py] wrote {written} rows, skipped {skipped}", file=sys.stderr)
    return 0 if written > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
