// The Places library is loaded by App's Maps JavaScript API loader.
// Keep the actual prediction so toPlace() carries its billing session token.
export function createPlacesSearch(getLibrary, bounds) {
  let sessionToken = null;

  function library() {
    const places = getLibrary();
    if (
      !places?.AutocompleteSuggestion?.fetchAutocompleteSuggestions ||
      !places?.AutocompleteSessionToken
    ) {
      throw new Error("Places API (New) is unavailable");
    }
    return places;
  }

  return {
    resetSession() {
      sessionToken = null;
    },

    async getPredictions(input) {
      const query = input.trim();
      if (!query) {
        sessionToken = null;
        return [];
      }
      const places = library();
      sessionToken ??= new places.AutocompleteSessionToken();
      const requestToken = sessionToken;
      const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: query,
        locationRestriction: bounds,
        includedRegionCodes: ["ca"],
        sessionToken: requestToken,
      });
      return (suggestions || [])
        .filter((suggestion) => suggestion.placePrediction)
        .map(({ placePrediction }) => ({
          place_id: placePrediction.placeId,
          description: placePrediction.text.toString(),
          placePrediction,
          sessionToken: requestToken,
        }));
    },

    async getPlaceDetails(prediction) {
      if (!prediction?.placePrediction) return null;
      // A details request consumes the selected search session, including when
      // it fails. A subsequent search must not reuse its billing token.
      if (sessionToken === prediction.sessionToken) sessionToken = null;
      const place = prediction.placePrediction.toPlace();
      await place.fetchFields({ fields: ["formattedAddress", "location"] });
      if (!place.location) return null;
      return {
        formatted_address: place.formattedAddress,
        geometry: { location: place.location },
      };
    },
  };
}
