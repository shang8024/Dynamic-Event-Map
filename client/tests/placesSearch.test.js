import test from "node:test";
import assert from "node:assert/strict";
import { createPlacesSearch } from "../src/services/placesSearch.js";

const bounds = { north: 43.86, south: 43.58, west: -79.64, east: -79.12 };

function fixture({ detailsError = false, missingLocation = false } = {}) {
  const requests = [];
  const fieldRequests = [];
  let tokenCount = 0;
  let selectedPrediction = null;
  const location = { lat: () => 43.65, lng: () => -79.38 };
  const library = {
    AutocompleteSessionToken: class {
      constructor() {
        this.id = ++tokenCount;
      }
    },
    AutocompleteSuggestion: {
      async fetchAutocompleteSuggestions(request) {
        requests.push(request);
        const prediction = {
          placeId: "toronto-place",
          text: { toString: () => "Toronto City Hall" },
          toPlace() {
            selectedPrediction = prediction;
            return {
              formattedAddress: "100 Queen St W, Toronto, ON",
              location: missingLocation ? undefined : location,
              async fetchFields(request) {
                fieldRequests.push(request);
                if (detailsError) throw new Error("Details request failed");
              },
            };
          },
        };
        return { suggestions: [{ placePrediction: prediction }, {}] };
      },
    },
  };
  return {
    search: createPlacesSearch(() => library, bounds),
    requests,
    fieldRequests,
    location,
    selectedPrediction: () => selectedPrediction,
  };
}

test("Places New queries bias GTA within Canada and share one token while typing", async () => {
  const { search, requests } = fixture();
  const first = await search.getPredictions("  Toronto  ");
  await search.getPredictions("Toronto city");

  assert.equal(requests[0].input, "Toronto");
  assert.deepEqual(requests[0].locationBias, bounds);
  assert.equal(requests[0].locationRestriction, undefined);
  assert.deepEqual(requests[0].includedRegionCodes, ["ca"]);
  assert.equal(requests[0].sessionToken, requests[1].sessionToken);
  assert.equal(first.length, 1);
  assert.equal(first[0].place_id, "toronto-place");
  assert.equal(first[0].description, "Toronto City Hall");
});

test("selection uses the original prediction and only Essentials fields, then starts a new session", async () => {
  const { search, requests, fieldRequests, location, selectedPrediction } = fixture();
  const [prediction] = await search.getPredictions("city hall");
  const place = await search.getPlaceDetails(prediction);

  assert.equal(selectedPrediction(), prediction.placePrediction);
  assert.deepEqual(fieldRequests, [{ fields: ["formattedAddress", "location"] }]);
  assert.equal(place.formatted_address, "100 Queen St W, Toronto, ON");
  assert.equal(place.geometry.location, location);
  assert.equal(place.place_id, "toronto-place");
  await search.getPredictions("union station");
  assert.notEqual(requests[0].sessionToken, requests[1].sessionToken);
});

test("failed details also consume the session token", async () => {
  const { search, requests } = fixture({ detailsError: true });
  const [prediction] = await search.getPredictions("city hall");
  await assert.rejects(search.getPlaceDetails(prediction), /Details request failed/);
  await search.getPredictions("union station");
  assert.notEqual(requests[0].sessionToken, requests[1].sessionToken);
});

test("empty input and explicit abandonment reset sessions without making empty requests", async () => {
  const { search, requests } = fixture();
  await search.getPredictions("city hall");
  assert.deepEqual(await search.getPredictions("   "), []);
  await search.getPredictions("union station");
  search.resetSession();
  await search.getPredictions("CN Tower");

  assert.equal(requests.length, 3);
  assert.equal(new Set(requests.map((request) => request.sessionToken)).size, 3);
});

test("missing place coordinates are not passed to the map", async () => {
  const { search } = fixture({ missingLocation: true });
  const [prediction] = await search.getPredictions("city hall");
  assert.equal(await search.getPlaceDetails(prediction), null);
  assert.equal(await search.getPlaceDetails(null), null);
});

test("a missing New Places library produces a configuration error", async () => {
  const search = createPlacesSearch(() => ({}), bounds);
  await assert.rejects(search.getPredictions("city hall"), /Places API \(New\) is unavailable/);
});
