import React, { useCallback, useEffect, useRef, useState } from "react";
import { LoadScript, GoogleMap, Marker } from "@react-google-maps/api";
import EventInfo from "../../components/EventInfo.jsx";
import EventForm from "../../components/EventForm.jsx";

// Map styles (retro theme)
const MAP_STYLES = [
  { elementType: "geometry", stylers: [{ color: "#ebe3cd" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#523735" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f5f1e6" }] },
  {
    featureType: "administrative",
    elementType: "geometry.stroke",
    stylers: [{ color: "#c9b2a6" }],
  },
  {
    featureType: "landscape.natural",
    elementType: "geometry",
    stylers: [{ color: "#dfd2ae" }],
  },
  {
    featureType: "poi",
    elementType: "geometry",
    stylers: [{ color: "#dfd2ae" }],
  },
  {
    featureType: "poi.park",
    elementType: "geometry.fill",
    stylers: [{ color: "#a5b076" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#f5f1e6" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#f8c967" }],
  },
  {
    featureType: "transit.line",
    elementType: "geometry",
    stylers: [{ color: "#dfd2ae" }],
  },
  {
    featureType: "water",
    elementType: "geometry.fill",
    stylers: [{ color: "#b9d3c2" }],
  },
];

const torontoBounds = {
  north: 43.855457,
  south: 43.581024,
  west: -79.639219,
  east: -79.115219,
};

const mapOptions = {
  styles: MAP_STYLES,
  restriction: { latLngBounds: torontoBounds, strictBounds: true },
  disableDefaultUI: true,
  gestureHandling: "greedy",
};

const MOCK_EVENTS = [
  {
    id: 1,
    title: "Community Picnic",
    description: "A fun picnic at the park for all ages.",
    position: { lat: 43.7239, lng: -79.4512 },
  },
  {
    id: 2,
    title: "Art in the Park",
    description: "An outdoor art exhibition featuring local artists.",
    position: { lat: 43.7249, lng: -79.4522 },
  },
];

export default function EventMap() {
  // refs
  const mapRef = useRef(null);
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);
  const searchTimeoutRef = useRef(null);
  const lastSelectedRef = useRef(null);

  // UI state
  const [center, setCenter] = useState({ lat: 43.7, lng: -79.42 });
  const [events, setEvents] = useState(MOCK_EVENTS);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [initialFormData, setInitialFormData] = useState(null);

  // map & search state
  const [userPos, setUserPos] = useState(null);
  const [mapHeight, setMapHeight] = useState(600);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [predictions, setPredictions] = useState([]);
  // Fetch place predictions as the user types (debounced)
  // Helper: promise-based wrapper for AutocompleteService.getPlacePredictions
  const getPredictions = (input) => {
    return new Promise((resolve) => {
      if (!window.google || !window.google.maps || !window.google.maps.places) return resolve([]);
      try {
        const service = new window.google.maps.places.AutocompleteService();
        const bounds = new window.google.maps.LatLngBounds(
          { lat: torontoBounds.south, lng: torontoBounds.west },
          { lat: torontoBounds.north, lng: torontoBounds.east }
        );
        service.getPlacePredictions(
          { input, bounds, strictBounds: true, componentRestrictions: { country: "ca" } },
          (preds, status) => {
            if (status === window.google.maps.places.PlacesServiceStatus.OK && preds)
              resolve(preds);
            else resolve([]);
          }
        );
      } catch (err) {
        console.warn("getPredictions error", err);
        resolve([]);
      }
    });
  };

  // Helper: promise-based wrapper for PlacesService.getDetails
  const getPlaceDetails = (placeId) => {
    return new Promise((resolve) => {
      if (!window.google || !window.google.maps || !window.google.maps.places) return resolve(null);
      const service = new window.google.maps.places.PlacesService(
        mapRef.current || document.createElement("div")
      );
      try {
        service.getDetails(
          { placeId, fields: ["formatted_address", "geometry"] },
          (place, status) => {
            if (status === window.google.maps.places.PlacesServiceStatus.OK && place)
              resolve(place);
            else resolve(null);
          }
        );
      } catch (err) {
        console.warn("getPlaceDetails error", err);
        resolve(null);
      }
    });
  };

  // Debounced effect: fetch predictions when inputValue changes
  useEffect(() => {
    if (!mapLoaded) return;
    if (!inputValue || inputValue.length < 2) {
      setPredictions([]);
      return;
    }
    // If input equals the last selected prediction, don't fetch predictions again
    if (lastSelectedRef.current && inputValue === lastSelectedRef.current) {
      setPredictions([]);
      return;
    }
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(async () => {
      const preds = await getPredictions(inputValue);
      setPredictions(preds);
    }, 250);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [inputValue, mapLoaded]);

  const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;

  // load user position and center map
  useEffect(() => {
    if (!navigator?.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        setUserPos(pos);
        setCenter(pos);
      },
      (err) => console.warn("Geolocation error:", err),
      { enableHighAccuracy: true }
    );
  }, []);

  // We use AutocompleteService + PlacesService to show our own dropdown; do not attach
  // the built-in google.maps.places.Autocomplete to avoid the native Google dropdown.

  const onMapLoad = useCallback((mapInstance) => {
    mapRef.current = mapInstance;
    setMapLoaded(true);
  }, []);

  const onMarkerClick = useCallback((event) => {
    setSelectedEvent(event);
  }, []);

  // When the right panel opens/closes, give the map a moment to resize and recenter
  useEffect(() => {
    if (!mapRef.current) return;
    const t = setTimeout(() => {
      try {
        const target = selectedEvent?.position || center;
        mapRef.current.panTo(target);
      } catch {
        // ignore
      }
    }, 320);
    return () => clearTimeout(t);
  }, [selectedEvent, center]);

  // compute available height for map so it fills remaining window space
  useEffect(() => {
    function updateHeight() {
      if (!wrapperRef.current) return;
      const rect = wrapperRef.current.getBoundingClientRect();
      const GAP_PX = 16; // tailwind bottom-4
      const style = window.getComputedStyle(wrapperRef.current);
      const paddingBottom = parseFloat(style?.paddingBottom) || 0;
      const available = Math.max(window.innerHeight - rect.top - GAP_PX - paddingBottom, 200);
      setMapHeight(available);
    }

    updateHeight();
    let timeout = null;
    function onResize() {
      clearTimeout(timeout);
      timeout = setTimeout(updateHeight, 80);
    }
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      clearTimeout(timeout);
    };
  }, []);

  return (
    <div>
      <div className="divider mt-1"></div>
      <div
        className="relative flex overflow-hidden h-full w-full"
        ref={wrapperRef}
        style={{ paddingBottom: "1rem" }}
      >
        {/* Left: Map area (full width when no selection, 3/4 when an event is selected) */}
        <div
          className={(selectedEvent ? "w-3/4" : "w-full") + " h-full transition-all duration-300"}
          style={{ minHeight: 400 }}
        >
          <LoadScript googleMapsApiKey={API_KEY} libraries={["places"]}>
            <GoogleMap
              mapContainerStyle={{ width: "100%", height: `${mapHeight}px` }}
              center={center}
              zoom={14}
              options={mapOptions}
              onLoad={onMapLoad}
            >
              {/* Search box (autocomplete) - positioned over the map */}
              <div className="absolute top-4 right-4 z-30">
                <div className="relative">
                  <div className="bg-base-200/70 flex items-center gap-2 rounded-full p-2 shadow">
                    <label className="input flex items-center gap-2 rounded-full">
                      <svg
                        className="h-[1em] opacity-50"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                      >
                        <g
                          strokeLinejoin="round"
                          strokeLinecap="round"
                          strokeWidth="2.5"
                          fill="none"
                          stroke="currentColor"
                        >
                          <circle cx="11" cy="11" r="8"></circle>
                          <path d="m21 21-4.3-4.3"></path>
                        </g>
                      </svg>
                      <input
                        ref={inputRef}
                        type="search"
                        required
                        placeholder="Search location"
                        value={inputValue}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (lastSelectedRef.current && v !== lastSelectedRef.current)
                            lastSelectedRef.current = null;
                          setInputValue(v);
                        }}
                        className="w-64 bg-transparent outline-none"
                      />
                    </label>
                    <button
                      className="btn btn-neutral rounded-full"
                      onClick={() => {
                        (async () => {
                          // Prefer existing predictions
                          let p = predictions && predictions.length > 0 ? predictions[0] : null;
                          // If none are available, try a live lookup
                          if (!p && inputValue && inputValue.length > 1) {
                            const live = await getPredictions(inputValue);
                            if (live && live.length > 0) p = live[0];
                          }

                          if (p) {
                            setPredictions([]);
                            setInputValue(p.description);
                            lastSelectedRef.current = p.description;
                            const place = await getPlaceDetails(p.place_id);
                            if (place && place.geometry) {
                              const lat = place.geometry.location.lat();
                              const lng = place.geometry.location.lng();
                              setInitialFormData({
                                address: place.formatted_address || p.description,
                                lat,
                                lng,
                              });
                              setShowModal(true);
                              if (mapRef.current) {
                                try {
                                  mapRef.current.panTo({ lat, lng });
                                  mapRef.current.setZoom(15);
                                } catch (err) {
                                  console.warn(err);
                                }
                              }
                            }
                          } else {
                            alert("Please pick an address from the suggestions.");
                          }
                        })();
                      }}
                    >
                      Search
                    </button>
                  </div>

                  {/* Predictions dropdown */}
                  {predictions && predictions.length > 0 && (
                    <div
                      className={
                        "dropdown dropdown-bottom absolute z-40 " +
                        (predictions.length > 0 ? "dropdown-open" : "")
                      }
                    >
                      <div tabIndex={0} role="button" className="btn sr-only m-1">
                        Open ⬇️
                      </div>
                      <ul
                        tabIndex={-1}
                        className="dropdown-content menu bg-base-100 rounded-box z-50 w-80 p-2 shadow-sm"
                      >
                        {predictions.map((p) => (
                          <li key={p.place_id}>
                            <a
                              onClick={() => {
                                (async () => {
                                  setPredictions([]);
                                  setInputValue(p.description);
                                  lastSelectedRef.current = p.description;
                                  const place = await getPlaceDetails(p.place_id);
                                  if (place && place.geometry) {
                                    const lat = place.geometry.location.lat();
                                    const lng = place.geometry.location.lng();
                                    setInitialFormData({
                                      address: place.formatted_address || p.description,
                                      lat,
                                      lng,
                                    });
                                    setShowModal(true);
                                    if (mapRef.current) {
                                      try {
                                        mapRef.current.panTo({ lat, lng });
                                        mapRef.current.setZoom(15);
                                      } catch (err) {
                                        console.warn(err);
                                      }
                                    }
                                  }
                                })();
                              }}
                            >
                              {p.description}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
              {/* user location marker */}
              {userPos && (
                <Marker
                  key="user"
                  position={userPos}
                  icon={{
                    url:
                      "data:image/svg+xml;utf-8," +
                      encodeURIComponent(
                        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36"><circle cx="12" cy="7" r="3" fill="#4285F4"/><path d="M12 11c-3.3 0-6 2.7-6 6v1h12v-1c0-3.3-2.7-6-6-6z" fill="#4285F4"/></svg>`
                      ),
                    // scaledSize as plain object — Maps API will accept it in many runtimes
                    scaledSize: { width: 36, height: 36 },
                  }}
                />
              )}

              {/* event markers */}
              {events.map((ev) => (
                <Marker
                  key={ev.id}
                  position={ev.position}
                  title={ev.title}
                  onClick={() => onMarkerClick(ev)}
                />
              ))}
            </GoogleMap>
            {/* Modal for EventForm */}
            {showModal && (
              <div className="fixed inset-0 z-40 flex items-center justify-center">
                <div
                  className="absolute inset-0 bg-black opacity-40"
                  onClick={() => setShowModal(false)}
                />
                <div className="z-50 w-11/12 rounded p-4 shadow-lg md:w-1/2">
                  <EventForm
                    initialData={initialFormData || {}}
                    onCancel={() => setShowModal(false)}
                    onSaved={(newEvent) => {
                      setEvents((prev) => [...prev, { id: `ev-${Date.now()}`, ...newEvent }]);
                      setShowModal(false);
                    }}
                  />
                </div>
              </div>
            )}
          </LoadScript>
        </div>

        {/* Right: manual aside with EventInfo content */}
        <aside
          className={
            "bg-base-100 absolute top-0 right-0 bottom-4 z-20 w-1/4 overflow-auto transition-transform duration-300 " +
            (selectedEvent ? "translate-x-0" : "translate-x-full")
          }
          aria-hidden={!selectedEvent}
        >
          <EventInfo event={selectedEvent} onClose={() => setSelectedEvent(null)} />
        </aside>
      </div>
    </div>
  );
}
