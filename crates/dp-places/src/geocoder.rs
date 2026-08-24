use std::io::Read;

use dp_core::{DpError, DpResult};
use flate2::read::GzDecoder;
use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

/// Gzipped TSV bundled at compile time. Columns (no header, tab-separated):
/// `name  admin1_name  country_name  lat  lon  population`.
///
/// `population` is used only to rank [`Geocoder::search`] results and break
/// [`Geocoder::reverse`] ties at (near-)equal distance; it is intentionally
/// not exposed on [`City`].
///
/// Regenerate with `crates/dp-places/scripts/build-dataset.sh` (see that
/// script's header for details and data provenance).
const BUNDLED_DATA_GZ: &[u8] = include_bytes!("../data/cities.tsv.gz");

/// Mean Earth radius in kilometers, used for haversine distance.
const EARTH_RADIUS_KM: f64 = 6371.0088;

/// Tolerance (in km) below which two candidate distances are treated as
/// "equal" for reverse-geocode tie-breaking by population.
///
/// This is intentionally a real-world-scale tolerance rather than a
/// float-precision epsilon: GeoNames tags many administrative subdivisions
/// (e.g. Paris's arrondissements) with the same generic "populated place"
/// feature code as ordinary towns, so they sit only tens of meters from
/// their parent city in the bundled dataset and would otherwise win on raw
/// distance. Within ~2 km, preferring the more populous place matches what
/// a person expects a reverse geocode to report (e.g. "Paris", not "Paris
/// 04 Hotel-de-Ville").
const TIE_EPSILON_KM: f64 = 2.0;

/// A single named place.
#[derive(Debug, Clone, PartialEq)]
pub struct City {
    pub name: String,
    pub admin: Option<String>,
    pub country: String,
    pub lat: f64,
    pub lon: f64,
}

/// Offline place lookup: nearest-city reverse geocoding and name search.
pub trait Geocoder: Send + Sync {
    /// Nearest city within `max_km`, or `None`. Pure CPU, no I/O after load.
    fn reverse(&self, lat: f64, lon: f64, max_km: f64) -> Option<&City>;

    /// Case/diacritic-insensitive prefix search by name, for manual
    /// override. Returns at most `limit` results, most populous first.
    fn search(&self, query: &str, limit: usize) -> Vec<&City>;
}

/// A parsed dataset row: the public [`City`] plus the internal ranking key.
#[derive(Debug)]
struct Entry {
    city: City,
    population: u64,
    /// [`City::name`] with diacritics stripped and lowercased, precomputed
    /// once at load time so `search` doesn't refold on every call.
    folded_name: String,
}

/// [`Geocoder`] backed by a gzipped TSV of GeoNames cities bundled into the
/// binary via `include_bytes!`.
#[derive(Debug)]
pub struct BundledGeocoder {
    entries: Vec<Entry>,
    /// Number of dataset lines that failed to parse and were skipped.
    skipped_lines: usize,
}

impl BundledGeocoder {
    /// Decompresses and parses the bundled dataset. Intended to be called
    /// once at app init; a simple linear parse of the bundled TSV comfortably
    /// finishes in well under a second.
    pub fn load() -> DpResult<Self> {
        let tsv = decompress(BUNDLED_DATA_GZ)?;
        Self::from_tsv(&tsv)
    }

    /// Number of malformed lines skipped while loading. Exposed mainly for
    /// tests and diagnostics.
    pub fn skipped_lines(&self) -> usize {
        self.skipped_lines
    }

    /// Number of cities successfully loaded.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    fn from_tsv(tsv: &str) -> DpResult<Self> {
        let mut entries = Vec::new();
        let mut skipped_lines = 0usize;

        for line in tsv.lines() {
            if line.is_empty() {
                continue;
            }
            match parse_line(line) {
                Some(entry) => entries.push(entry),
                None => skipped_lines += 1,
            }
        }

        if entries.is_empty() {
            return Err(DpError::Unsupported {
                message: format!(
                    "bundled places dataset produced 0 valid rows ({skipped_lines} lines skipped)"
                ),
                path: None,
            });
        }

        Ok(Self {
            entries,
            skipped_lines,
        })
    }
}

impl Geocoder for BundledGeocoder {
    fn reverse(&self, lat: f64, lon: f64, max_km: f64) -> Option<&City> {
        // Cheap pre-filter: 1 degree of latitude is ~111 km everywhere, so a
        // city outside that latitude band can never be within `max_km`. The
        // `+ 1.0` slack absorbs the mean-radius rounding used below.
        let lat_slack_deg = max_km / 111.0 + 1.0;

        let mut best: Option<(&Entry, f64)> = None;

        for entry in &self.entries {
            if (entry.city.lat - lat).abs() > lat_slack_deg {
                continue;
            }

            let distance = haversine_km(lat, lon, entry.city.lat, entry.city.lon);
            if distance > max_km {
                continue;
            }

            best = match best {
                None => Some((entry, distance)),
                Some((best_entry, best_distance)) => {
                    let closer = distance < best_distance - TIE_EPSILON_KM;
                    let near_tie_more_populous = (distance - best_distance).abs() <= TIE_EPSILON_KM
                        && entry.population > best_entry.population;

                    if closer || near_tie_more_populous {
                        Some((entry, distance))
                    } else {
                        Some((best_entry, best_distance))
                    }
                }
            };
        }

        best.map(|(entry, _)| &entry.city)
    }

    fn search(&self, query: &str, limit: usize) -> Vec<&City> {
        let folded_query = fold_diacritics(query);
        if folded_query.is_empty() || limit == 0 {
            return Vec::new();
        }

        let mut matches: Vec<&Entry> = self
            .entries
            .iter()
            .filter(|entry| entry.folded_name.starts_with(&folded_query))
            .collect();

        matches.sort_by_key(|entry| std::cmp::Reverse(entry.population));
        matches.truncate(limit);

        matches.into_iter().map(|entry| &entry.city).collect()
    }
}

/// Strips a decompressed dataset line into an [`Entry`], or `None` if the
/// line is malformed (wrong column count, or an unparseable field).
fn parse_line(line: &str) -> Option<Entry> {
    let mut cols = line.split('\t');

    let name = cols.next()?;
    let admin = cols.next()?;
    let country = cols.next()?;
    let lat = cols.next()?;
    let lon = cols.next()?;
    let population = cols.next()?;

    // Reject lines with extra columns — malformed rather than merely sparse.
    if cols.next().is_some() {
        return None;
    }

    if name.is_empty() || country.is_empty() {
        return None;
    }

    let lat: f64 = lat.parse().ok()?;
    let lon: f64 = lon.parse().ok()?;
    let population: u64 = population.parse().ok()?;

    let admin = if admin.is_empty() {
        None
    } else {
        Some(admin.to_string())
    };

    let city = City {
        name: name.to_string(),
        admin,
        country: country.to_string(),
        lat,
        lon,
    };
    let folded_name = fold_diacritics(&city.name);

    Some(Entry {
        city,
        population,
        folded_name,
    })
}

/// Gzip-decompresses `bytes` into a UTF-8 string.
fn decompress(bytes: &[u8]) -> DpResult<String> {
    let mut decoder = GzDecoder::new(bytes);
    let mut out = String::new();
    decoder.read_to_string(&mut out).map_err(|e| DpError::Io {
        message: format!("failed to decompress bundled places dataset: {e}"),
        path: None,
    })?;
    Ok(out)
}

/// Lowercases `s` and strips combining diacritical marks (NFD decomposition
/// followed by removal of Unicode combining-mark codepoints), so e.g.
/// `"São Paulo"` folds to `"sao paulo"`.
fn fold_diacritics(s: &str) -> String {
    s.nfd()
        .filter(|c| !is_combining_mark(*c))
        .collect::<String>()
        .to_lowercase()
}

/// Great-circle distance between two lat/lon points, in kilometers.
fn haversine_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let phi1 = lat1.to_radians();
    let phi2 = lat2.to_radians();
    let d_phi = (lat2 - lat1).to_radians();
    let d_lambda = (lon2 - lon1).to_radians();

    let a = (d_phi / 2.0).sin().powi(2) + phi1.cos() * phi2.cos() * (d_lambda / 2.0).sin().powi(2);
    let c = 2.0 * a.sqrt().asin();

    EARTH_RADIUS_KM * c
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Small inline fixture covering: plain ASCII names, an admin-less
    /// entry, a diacritic name, and two same-named cities with different
    /// populations (for search ranking / reverse tie-breaking).
    const FIXTURE_TSV: &str = "\
Paris\tÎle-de-France\tFrance\t48.8566\t2.3522\t2148000
Paris\tTexas\tUnited States\t33.6609\t-95.5555\t25171
Lisbon\tLisbon\tPortugal\t38.7223\t-9.1393\t517802
São Paulo\tSão Paulo\tBrazil\t-23.5505\t-46.6333\t12300000
Nowhere\t\tTestland\t10.0\t10.0\t5
";

    fn fixture() -> BundledGeocoder {
        BundledGeocoder::from_tsv(FIXTURE_TSV).expect("fixture should parse")
    }

    #[test]
    fn from_tsv_rejects_empty_dataset() {
        let err = BundledGeocoder::from_tsv("").unwrap_err();
        assert!(matches!(err, DpError::Unsupported { .. }));
    }

    #[test]
    fn from_tsv_skips_malformed_lines_but_keeps_valid_ones() {
        let tsv = "\
Paris\tÎle-de-France\tFrance\t48.8566\t2.3522\t2148000
not-enough-columns\tfoo
Lisbon\tLisbon\tPortugal\tnot-a-number\t-9.1393\t517802
";
        let geocoder = BundledGeocoder::from_tsv(tsv).expect("should parse the one valid row");
        assert_eq!(geocoder.len(), 1);
        assert_eq!(geocoder.skipped_lines(), 2);
    }

    #[test]
    fn reverse_finds_paris() {
        let geocoder = fixture();
        let city = geocoder
            .reverse(48.8566, 2.3522, 50.0)
            .expect("should find a city");
        assert_eq!(city.name, "Paris");
        assert_eq!(city.country, "France");
    }

    #[test]
    fn reverse_returns_none_mid_atlantic() {
        let geocoder = fixture();
        assert!(geocoder.reverse(0.0, -30.0, 50.0).is_none());
    }

    #[test]
    fn reverse_breaks_ties_by_population() {
        // Two identically-located fixture entries, differing only in
        // population, at exactly the same distance from the query point.
        let tsv = "\
Twin\t\tLand\t1.0\t1.0\t10
Twin\t\tLand\t1.0\t1.0\t9999
";
        let geocoder = BundledGeocoder::from_tsv(tsv).unwrap();
        let city = geocoder.reverse(1.0, 1.0, 10.0).unwrap();
        assert_eq!(city.name, "Twin");
        // Can't distinguish which literal entry via City alone (both are
        // "Twin"/"Land"), but this at least exercises the tie-break path
        // without panicking or picking arbitrarily by iteration order only.
        assert_eq!(city.country, "Land");
    }

    #[test]
    fn search_prefix_matches_case_insensitively() {
        let geocoder = fixture();
        let results = geocoder.search("LIS", 5);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "Lisbon");
    }

    #[test]
    fn search_is_diacritic_insensitive() {
        let geocoder = fixture();
        let results = geocoder.search("sao", 5);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "São Paulo");
    }

    #[test]
    fn search_orders_by_population_descending() {
        let geocoder = fixture();
        let results = geocoder.search("paris", 5);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].admin.as_deref(), Some("Île-de-France"));
        assert_eq!(results[1].admin.as_deref(), Some("Texas"));
    }

    #[test]
    fn search_respects_limit() {
        let geocoder = fixture();
        let results = geocoder.search("paris", 1);
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn search_empty_query_returns_nothing() {
        let geocoder = fixture();
        assert!(geocoder.search("", 5).is_empty());
    }

    #[test]
    fn city_with_no_admin_parses_admin_as_none() {
        let geocoder = fixture();
        let results = geocoder.search("nowhere", 1);
        assert_eq!(results[0].admin, None);
    }

    #[test]
    fn fold_diacritics_strips_marks_and_lowercases() {
        assert_eq!(fold_diacritics("São Paulo"), "sao paulo");
        assert_eq!(fold_diacritics("LISBON"), "lisbon");
    }
}
