import { mockIPC } from "@tauri-apps/api/mocks";
import { listPlaceCounts, searchCities, setMediaPlace, startGeocode } from "./places";
import { ApiError } from "./client";
import type { City, PlaceCount } from "./places";

function place(id: number, name: string): PlaceCount["place"] {
  return { id, lat: 38.7223, lon: -9.1393, name, admin: "Lisboa", country: "Portugal", source: "geocoder" };
}

function city(name: string): City {
  return { name, admin: "Lisboa", country: "Portugal", lat: 38.7223, lon: -9.1393 };
}

it("starts a geocode sweep with no arguments and returns the started job id", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "start_geocode") {
      received = args;
      return "geocode-0";
    }
    return undefined;
  });
  await expect(startGeocode()).resolves.toBe("geocode-0");
  expect(received).toEqual({});
});

it("wraps structured errors from start_geocode", async () => {
  mockIPC(() => {
    throw { code: "db", message: "boom" };
  });
  await expect(startGeocode()).rejects.toBeInstanceOf(ApiError);
});

it("lists place counts with no arguments", async () => {
  const counts: PlaceCount[] = [{ place: place(1, "Lisbon"), count: 3 }];
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "list_place_counts") {
      received = args;
      return counts;
    }
    return undefined;
  });
  await expect(listPlaceCounts()).resolves.toEqual(counts);
  expect(received).toEqual({});
});

it("wraps structured errors from list_place_counts", async () => {
  mockIPC(() => {
    throw { code: "db", message: "boom" };
  });
  await expect(listPlaceCounts()).rejects.toBeInstanceOf(ApiError);
});

it("searches cities, round-tripping the query", async () => {
  const results = [city("Lisbon")];
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "search_cities") {
      received = args;
      return results;
    }
    return undefined;
  });
  await expect(searchCities("lisb")).resolves.toEqual(results);
  expect(received).toEqual({ query: "lisb" });
});

it("wraps structured errors from search_cities", async () => {
  mockIPC(() => {
    throw { code: "db", message: "boom" };
  });
  await expect(searchCities("lisb")).rejects.toBeInstanceOf(ApiError);
});

it("sets a manual place override, round-tripping media ids and the city", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "set_media_place") {
      received = args;
      return null;
    }
    return undefined;
  });
  await setMediaPlace([1, 2], city("Lisbon"));
  expect(received).toEqual({ mediaIds: [1, 2], city: city("Lisbon") });
});

it("clears a place override when city is null", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "set_media_place") {
      received = args;
      return null;
    }
    return undefined;
  });
  await setMediaPlace([1], null);
  expect(received).toEqual({ mediaIds: [1], city: null });
});

it("wraps structured errors from set_media_place", async () => {
  mockIPC(() => {
    throw { code: "db", message: "boom" };
  });
  await expect(setMediaPlace([1], null)).rejects.toBeInstanceOf(ApiError);
});
