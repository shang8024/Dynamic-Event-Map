import React, { useCallback, useEffect, useRef, useState } from "react";
import { LoadScript, GoogleMap, Marker } from "@react-google-maps/api";
import EventInfo from "../../components/EventInfo.jsx";
import EventForm from "../../components/EventForm.jsx";
import { fetchEvents, deleteEvent } from "../../services/eventsService";
import socket from "../../services/socket";

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


export default function EventMap() {
  // refs
  const mapRef = useRef(null);
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);
  const searchTimeoutRef = useRef(null);
  const lastSelectedRef = useRef(null);

  // UI state
  const [center, setCenter] = useState({ lat: 43.7, lng: -79.42 });
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [initialFormData, setInitialFormData] = useState(null);

  // map & search state
  const [userPos, setUserPos] = useState(null);
  const [mapHeight, setMapHeight] = useState(600);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [predictions, setPredictions] = useState([]);
  // small helper: ensure Places APIs are available
  const hasPlaces = useCallback(() => !!(window.google && window.google.maps && window.google.maps.places), []);

  // Helper: promise-based wrapper for AutocompleteService.getPlacePredictions
  const getPredictions = useCallback(
    (input) =>
      new Promise((resolve) => {
        if (!hasPlaces()) return resolve([]);
        try {
          const service = new window.google.maps.places.AutocompleteService();
          const bounds = new window.google.maps.LatLngBounds(
            { lat: torontoBounds.south, lng: torontoBounds.west },
            { lat: torontoBounds.north, lng: torontoBounds.east }
          );
          service.getPlacePredictions(
            { input, bounds, strictBounds: true, componentRestrictions: { country: "ca" } },
            (preds, status) => {
              if (status === window.google.maps.places.PlacesServiceStatus.OK && preds) resolve(preds);
              else resolve([]);
            }
          );
        } catch (err) {
          console.warn("getPredictions error", err);
          resolve([]);
        }
      }),
    [hasPlaces]
  );

  // Helper: promise-based wrapper for PlacesService.getDetails
  const getPlaceDetails = useCallback(
    (placeId) =>
      new Promise((resolve) => {
        if (!hasPlaces()) return resolve(null);
        const service = new window.google.maps.places.PlacesService(mapRef.current || document.createElement("div"));
        try {
          service.getDetails({ placeId, fields: ["formatted_address", "geometry"] }, (place, status) => {
            if (status === window.google.maps.places.PlacesServiceStatus.OK && place) resolve(place);
            else resolve(null);
          });
        } catch (err) {
          console.warn("getPlaceDetails error", err);
          resolve(null);
        }
      }),
    [hasPlaces]
  );

  // utility to pan the map safely
  const panToPosition = useCallback((pos, zoom = 15) => {
    if (!mapRef.current || !pos) return;
    try {
      mapRef.current.panTo(pos);
      if (zoom) mapRef.current.setZoom(zoom);
    } catch (err) {
      console.warn("panTo failed", err);
    }
  }, []);

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
  }, [inputValue, mapLoaded, getPredictions]);

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

  // We use AutocompleteService + PlacesService to show our own dropdown
  const onMapLoad = useCallback((mapInstance) => {
    mapRef.current = mapInstance;
    setMapLoaded(true);
  }, []);

  const onMarkerClick = useCallback((event) => {
    setSelectedEvent(event);
  }, []);

  // handler when a prediction is chosen (or button selects first match)
  const handlePredictionSelect = async (p) => {
    if (!p) return;
    setPredictions([]);
    setInputValue(p.description);
    lastSelectedRef.current = p.description;
    const place = await getPlaceDetails(p.place_id);
    if (place && place.geometry) {
      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();
      const created = {
        address: place.formatted_address || p.description,
        lat,
        lng,
      };
      setInitialFormData(created);
      setShowModal(true);
      panToPosition({ lat, lng }, 15);
    }
  };

  const handleSearchButton = async () => {
    // prefer existing predictions
    let p = predictions && predictions.length > 0 ? predictions[0] : null;
    if (!p && inputValue && inputValue.length > 1) {
      const live = await getPredictions(inputValue);
      if (live && live.length > 0) p = live[0];
    }
    if (p) handlePredictionSelect(p);
    else alert("Please pick an address from the suggestions.");
  };

  // When the right panel opens/closes, give the map a moment to resize and recenter
  useEffect(() => {
    if (!mapRef.current || !selectedEvent) return;
    const t = setTimeout(() => {
      try {
        mapRef.current.panTo(selectedEvent.position);
      } catch (err) {
        // ignore
        console.warn("panTo failed", err);
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

  // delete handler for events
  const handleDeleteEvent = async (id) => {
    if (!id) return;
    // optimistic: remove immediately
    const before = events;
    const remaining = before.filter((e) => String(e.id) !== String(id));
    setEvents(remaining);
    setSelectedEvent(null);
    try {
      await deleteEvent(id);
    } catch (err) {
      console.error('failed to delete event', err);
      // rollback
      setEvents(before);
      alert('Failed to delete event — changes rolled back');
    }
  };

  const handleEditEvent = (ev) => {
    if (!ev) return;
    setInitialFormData({
      id: ev.id,
      title: ev.title,
      description: ev.description,
      latitude: ev.position?.lat,
      longitude: ev.position?.lng,
    });
    setShowModal(true);
  };

  // optimistic update tracking: store original event by id so we can rollback if update fails
  const optimisticRef = useRef({});

  const handleOptimisticUpdate = (optimisticServerEvent) => {
    if (!optimisticServerEvent || !optimisticServerEvent.id) return;
    const id = optimisticServerEvent.id;
    setEvents((prev) => {
      const idx = prev.findIndex((p) => String(p.id) === String(id));
      const prevItem = idx >= 0 ? prev[idx] : null;
      if (prevItem) optimisticRef.current[id] = prevItem;
      const mapped = {
        id,
        title: optimisticServerEvent.title,
        description: optimisticServerEvent.description,
        position: { lat: Number(optimisticServerEvent.latitude ?? prevItem?.position?.lat), lng: Number(optimisticServerEvent.longitude ?? prevItem?.position?.lng) },
      };
      if (idx >= 0) {
        return prev.map((p) => (String(p.id) === String(id) ? mapped : p));
      }
      return [...prev, mapped];
    });
    // show the optimistic result
    setSelectedEvent((s) => (s && String(s.id) === String(optimisticServerEvent.id) ? { ...s, title: optimisticServerEvent.title, description: optimisticServerEvent.description, position: { lat: Number(optimisticServerEvent.latitude ?? s.position.lat), lng: Number(optimisticServerEvent.longitude ?? s.position.lng) } } : s));
  };

  const handleRollback = (originalData) => {
    if (!originalData || !originalData.id) return;
    const id = originalData.id;
    const prev = optimisticRef.current[id];
    if (prev) {
      setEvents((vals) => vals.map((v) => (String(v.id) === String(id) ? prev : v)));
      setSelectedEvent(prev);
      delete optimisticRef.current[id];
      alert('Update failed — changes rolled back');
    }
  };

  // Load events from server
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const rows = await fetchEvents();
        if (!mounted) return;
        // normalize rows into { id, title, description, position: { lat, lng } }
        const mapped = (rows || []).map((r) => ({
          id: r.id,
          title: r.title,
          description: r.description,
          position: { lat: Number(r.latitude ?? r.lat ?? 0), lng: Number(r.longitude ?? r.lng ?? 0) },
        }));
        setEvents(mapped);
      } catch (err) {
        console.warn('failed to load events', err);
      }
    })();
    return () => (mounted = false);
  }, []);

  // Realtime socket listeners for events
  useEffect(() => {
    function onCreated(ev) {
      const mapped = { id: ev.id, title: ev.title, description: ev.description, position: { lat: Number(ev.latitude ?? ev.lat), lng: Number(ev.longitude ?? ev.lng) } };
      setEvents((prev) => {
        if (prev.find((p) => String(p.id) === String(mapped.id))) return prev;
        return [...prev, mapped];
      });
    }
    function onUpdated(ev) {
      setEvents((prev) => prev.map((p) => (String(p.id) === String(ev.id) ? { id: ev.id, title: ev.title, description: ev.description, position: { lat: Number(ev.latitude ?? ev.lat), lng: Number(ev.longitude ?? ev.lng) } } : p)));
      setSelectedEvent((s) => (s && String(s.id) === String(ev.id) ? { ...s, title: ev.title, description: ev.description, position: { lat: Number(ev.latitude ?? s.position.lat), lng: Number(ev.longitude ?? s.position.lng) } } : s));
    }
    function onDeleted(payload) {
      setEvents((prev) => prev.filter((p) => String(p.id) !== String(payload.id)));
      setSelectedEvent((s) => (s && String(s.id) === String(payload.id) ? null : s));
    }

    socket.on("event:created", onCreated);
    socket.on("event:updated", onUpdated);
    socket.on("event:deleted", onDeleted);

    return () => {
      socket.off("event:created", onCreated);
      socket.off("event:updated", onUpdated);
      socket.off("event:deleted", onDeleted);
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
                    <button className="btn btn-neutral rounded-full" onClick={handleSearchButton}>
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
                            <a onClick={() => handlePredictionSelect(p)}>{p.description}</a>
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
                        `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 48 48"><path fill="#E8EAF6" d="M42 39H6V23L24 6l18 17z"/><path fill="#C5CAE9" d="m39 21l-5-5V9h5zM6 39h36v5H6z"/><path fill="#B71C1C" d="M24 4.3L4 22.9l2 2.2L24 8.4l18 16.7l2-2.2z"/><path fill="#D84315" d="M18 28h12v16H18z"/><path fill="#01579B" d="M21 17h6v6h-6z"/><path fill="#FF8A65" d="M27.5 35.5c-.3 0-.5.2-.5.5v2c0 .3.2.5.5.5s.5-.2.5-.5v-2c0-.3-.2-.5-.5-.5z"/></svg>`
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
                    onOptimistic={handleOptimisticUpdate}
                    onRollback={handleRollback}
                    onSaved={(serverEvent) => {
                      // serverEvent is expected to be the created/updated event returned by the API
                      const mapped = {
                        id: serverEvent.id,
                        title: serverEvent.title,
                        description: serverEvent.description,
                        position: { lat: Number(serverEvent.latitude ?? initialFormData?.latitude), lng: Number(serverEvent.longitude ?? initialFormData?.longitude) },
                      };
                      // if exists in list, replace; otherwise append
                      setEvents((prev) => {
                        const found = prev.find((p) => String(p.id) === String(mapped.id));
                        if (found) return prev.map((p) => (String(p.id) === String(mapped.id) ? mapped : p));
                        return [...prev, mapped];
                      });
                      setShowModal(false);
                      setSelectedEvent(mapped);
                      panToPosition(mapped.position, 15);
                      // clear any optimistic record for this id
                      if (mapped?.id) delete optimisticRef.current[mapped.id];
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
          <EventInfo
            event={selectedEvent}
            onClose={() => setSelectedEvent(null)}
            onEdit={handleEditEvent}
            onDelete={handleDeleteEvent}
          />
        </aside>
      </div>
    </div>
  );
}
