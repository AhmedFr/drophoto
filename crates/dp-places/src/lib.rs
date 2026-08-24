//! Offline place lookup: reverse geocoding and name search backed by a
//! bundled GeoNames-derived dataset. No network access at runtime.

mod geocoder;

pub use geocoder::{BundledGeocoder, City, Geocoder};
