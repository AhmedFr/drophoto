//! Integration tests against the full bundled GeoNames dataset.

use dp_places::{BundledGeocoder, Geocoder};

#[test]
fn load_parses_more_than_100_000_rows() {
    let geocoder = BundledGeocoder::load().expect("bundled dataset should load");
    assert!(
        geocoder.len() > 100_000,
        "expected > 100,000 rows, got {}",
        geocoder.len()
    );
}

#[test]
fn reverse_finds_paris() {
    let geocoder = BundledGeocoder::load().unwrap();
    let city = geocoder
        .reverse(48.8566, 2.3522, 50.0)
        .expect("should find a city near central Paris");
    assert_eq!(city.name, "Paris");
    assert_eq!(city.country, "France");
}

#[test]
fn reverse_returns_none_mid_atlantic() {
    let geocoder = BundledGeocoder::load().unwrap();
    assert!(geocoder.reverse(0.0, -30.0, 50.0).is_none());
}

#[test]
fn reverse_finds_lisbon_at_its_own_coordinates() {
    let geocoder = BundledGeocoder::load().unwrap();
    let city = geocoder
        .reverse(38.7223, -9.1393, 50.0)
        .expect("should find Lisbon");
    assert_eq!(city.name, "Lisbon");
    assert_eq!(city.country, "Portugal");
}

// NOTE: the task brief's literal example is `search("liss")`, presumably
// intending a match via the alternate name "Lissabon". The committed
// dataset only carries GeoNames' primary `name` column (per this task's
// explicit 6-column TSV ruling: name/admin/country/lat/lon/population —
// alternate names were deliberately excluded to keep the bundle small), so
// `search` matches on primary name only. "lisb" is used here instead, which
// is a genuine prefix of "Lisbon" and exercises the same case-insensitive
// prefix-matching behavior the brief is testing for.
#[test]
fn search_lisb_finds_lisbon() {
    let geocoder = BundledGeocoder::load().unwrap();
    let results = geocoder.search("lisb", 10);
    assert!(
        results
            .iter()
            .any(|c| c.name == "Lisbon" && c.country == "Portugal"),
        "expected Lisbon, Portugal in results: {:?}",
        results.iter().map(|c| (&c.name, &c.country)).collect::<Vec<_>>()
    );
}

#[test]
fn search_sao_finds_sao_paulo() {
    let geocoder = BundledGeocoder::load().unwrap();
    let results = geocoder.search("sao", 10);
    assert!(
        results
            .iter()
            .any(|c| c.name == "São Paulo" && c.country == "Brazil"),
        "expected São Paulo, Brazil in results: {:?}",
        results.iter().map(|c| (&c.name, &c.country)).collect::<Vec<_>>()
    );
    // Diacritic-insensitivity: the folded query "sao" must not require the
    // literal "ã" to be typed.
    assert!(!results.is_empty());
}

#[test]
fn search_is_case_insensitive() {
    let geocoder = BundledGeocoder::load().unwrap();
    let lower = geocoder.search("lisb", 5);
    let upper = geocoder.search("LISB", 5);
    assert_eq!(
        lower.iter().map(|c| &c.name).collect::<Vec<_>>(),
        upper.iter().map(|c| &c.name).collect::<Vec<_>>()
    );
    assert!(!lower.is_empty());
}
