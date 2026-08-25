# Third-Party Data & Attribution

## Place data — GeoNames

The city/place dataset bundled into `dp-places` (`crates/dp-places/data/cities.tsv.gz`,
regenerated via `crates/dp-places/scripts/build-dataset.sh`) is derived from the
[GeoNames](https://www.geonames.org/) geographical database.

> Place data © [GeoNames](https://www.geonames.org/) (geonames.org), licensed
> [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

This data powers reverse-geocoding and manual place search in the Places
feature; the resolved place names, admin regions, and countries shown in the
app are GeoNames data, unmodified in substance (only reshaped into a smaller
TSV for bundling).

## Map tiles — OpenFreeMap / OpenStreetMap

The Places map (`PlacesMap`) renders vector tiles served by
[OpenFreeMap](https://openfreemap.org/), built from
[OpenStreetMap](https://www.openstreetmap.org/copyright) data.

> Map tiles © [OpenFreeMap](https://openfreemap.org/) · Map data ©
> [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors,
> licensed [ODbL](https://opendatacommons.org/licenses/odbl/).

## Map rendering — MapLibre GL JS

The map is rendered client-side with [MapLibre GL
JS](https://github.com/maplibre/maplibre-gl-js) (`maplibre-gl` npm package),
distributed under the [BSD 3-Clause
License](https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt).
