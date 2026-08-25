use crate::state::AppState;
use dp_core::{DpError, NewPlace, PlaceCount, PlaceSource};
use dp_jobs::{GeocodeDeps, GeocodeJob, Job};
use dp_places::City;
use std::sync::Arc;
use tauri::State;

/// Cap on how many cities [`search_cities`] returns — plenty for a manual
/// place-override picker (the user is narrowing by typing, not browsing),
/// and small enough to stay snappy against the full bundled dataset.
const SEARCH_CITIES_LIMIT: usize = 20;

/// Starts (or reuses, if one is already running) the global reverse-geocode
/// sweep — see [`crate::state::AppState::start_geocode`] for why this has
/// no `drive_id` argument.
#[tauri::command]
pub async fn start_geocode(state: State<'_, AppState>) -> Result<String, DpError> {
    let deps = GeocodeDeps {
        catalog: state.catalog.clone(),
        geocoder: state.geocoder.clone(),
    };
    state.start_geocode(move |job_id| Arc::new(GeocodeJob::new(job_id, deps)) as Arc<dyn Job>)
}

#[tauri::command]
pub async fn list_place_counts(state: State<'_, AppState>) -> Result<Vec<PlaceCount>, DpError> {
    state.catalog.list_place_counts().await
}

/// Case/diacritic-insensitive prefix search over the bundled city dataset,
/// for the manual place-override picker. An empty `query` returns an empty
/// list rather than erroring — same as `dp_places::Geocoder::search` itself.
#[tauri::command]
pub async fn search_cities(state: State<'_, AppState>, query: String) -> Result<Vec<City>, DpError> {
    Ok(state
        .geocoder
        .search(&query, SEARCH_CITIES_LIMIT)
        .into_iter()
        .cloned()
        .collect())
}

/// Sets (`city` is `Some`) or clears (`city` is `None`) the place assigned
/// to every id in `media_ids` — the user's manual override, which the
/// reverse-geocode job then leaves alone forever (`Catalog::list_ungeocoded`
/// excludes any row with a `place_id`, regardless of `source`).
///
/// A `Some(city)` is upserted as a `PlaceSource::Manual` place — see
/// [`city_to_manual_place`] — even when a `Geocoder`-sourced place already
/// exists at the same name/admin/country: the two sources are deliberately
/// deduped separately (`upsert_place`'s identity includes `source`), so a
/// user's manual pick is never silently merged into (or contended with) a
/// row some other automated sweep already resolved.
#[tauri::command]
pub async fn set_media_place(
    state: State<'_, AppState>,
    media_ids: Vec<i64>,
    city: Option<City>,
) -> Result<(), DpError> {
    if media_ids.is_empty() {
        return Ok(());
    }

    let place_id = match city {
        Some(city) => {
            let place = state.catalog.upsert_place(city_to_manual_place(city)).await?;
            Some(place.id)
        }
        None => None,
    };

    state.catalog.set_media_place(&media_ids, place_id).await
}

/// Maps a [`City`] (from `dp_places::Geocoder::search`) to the
/// [`NewPlace`] a manual override upserts — pure so it's cheap to test
/// without an `AppState`.
pub(crate) fn city_to_manual_place(city: City) -> NewPlace {
    NewPlace {
        lat: city.lat,
        lon: city.lon,
        name: city.name,
        admin: city.admin,
        country: city.country,
        source: PlaceSource::Manual,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn city_to_manual_place_carries_every_field_and_forces_manual_source() {
        let city = City {
            name: "Lisbon".into(),
            admin: Some("Lisboa".into()),
            country: "Portugal".into(),
            lat: 38.7223,
            lon: -9.1393,
        };

        let place = city_to_manual_place(city);

        assert_eq!(place.name, "Lisbon");
        assert_eq!(place.admin.as_deref(), Some("Lisboa"));
        assert_eq!(place.country, "Portugal");
        assert_eq!(place.lat, 38.7223);
        assert_eq!(place.lon, -9.1393);
        assert_eq!(place.source, PlaceSource::Manual);
    }

    #[test]
    fn city_to_manual_place_preserves_a_none_admin() {
        let city = City {
            name: "Nowhere".into(),
            admin: None,
            country: "Testland".into(),
            lat: 0.0,
            lon: 0.0,
        };

        assert_eq!(city_to_manual_place(city).admin, None);
    }
}
