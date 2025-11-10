import React, { useCallback, useEffect, useRef, useState } from "react";
import { GoogleMap, Marker, MarkerClusterer } from "@react-google-maps/api";

// components
import EventInfo from "../../components/EventInfo.jsx";
import EventForm from "../../components/EventForm.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";

// services
import { fetchEvents, deleteEvent, fetchTodaySummary } from "../../services/eventsService";
import socket from "../../services/socket";
import { useNotifications } from "../../contexts/NotificationContext.jsx";

// -----------------------------
// Constants
// -----------------------------
const MAP_STYLES = [
  { elementType: "geometry", stylers: [{ color: "#ebe3cd" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#523735" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f5f1e6" }] },
  {
    featureType: "administrative",
    elementType: "geometry.stroke",
    stylers: [{ color: "#c9b2a6" }],
  },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#dfd2ae" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#dfd2ae" }] },
  { featureType: "poi.park", elementType: "geometry.fill", stylers: [{ color: "#a5b076" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#f5f1e6" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#f8c967" }] },
  { featureType: "transit.line", elementType: "geometry", stylers: [{ color: "#dfd2ae" }] },
  { featureType: "water", elementType: "geometry.fill", stylers: [{ color: "#b9d3c2" }] },
];

const TORONTO_BOUNDS = {
  north: 43.855457,
  south: 43.581024,
  west: -79.639219,
  east: -79.115219,
};

const MAP_OPTIONS = {
  styles: MAP_STYLES,
  restriction: { latLngBounds: TORONTO_BOUNDS, strictBounds: true },
  disableDefaultUI: true,
  gestureHandling: "greedy",
};

// MarkerClusterer options: disable zoom-on-click so our handler controls behavior
const CLUSTERER_OPTIONS = {
  zoomOnClick: false,
};

// -----------------------------
// Component
// -----------------------------
export default function EventMap() {
  // refs
  const mapRef = useRef(null);
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);
  const searchTimeoutRef = useRef(null);
  const lastSelectedRef = useRef(null);
  const optimisticRef = useRef({});

  // core state
  const [center, setCenter] = useState({ lat: 43.7, lng: -79.42 });
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [initialFormData, setInitialFormData] = useState(null);

  // map & search UI state
  const [userPos, setUserPos] = useState(null);
  const [mapHeight, setMapHeight] = useState(600);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [predictions, setPredictions] = useState([]);
  const [mode, setMode] = useState("search"); // 'search' | 'add' | 'event'
  // toggles for panels
  const [filterOpen, setFilterOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(true);
  const [statsOpen, setStatsOpen] = useState(true);
  // filters
  const [filterTime, setFilterTime] = useState("all");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterDistanceKm, setFilterDistanceKm] = useState(0);

  // Cluster pagination state
  const [clusterEvents, setClusterEvents] = useState([]); // array of events in current cluster
  const [clusterIndex, setClusterIndex] = useState(0); // which event in cluster is shown

  const { user } = useAuth();
  const { push } = useNotifications();

  // -----------------------------
  // Helpers
  // -----------------------------
  const hasPlaces = useCallback(
    () => !!(window.google && window.google.maps && window.google.maps.places),
    []
  );

  const getPredictions = useCallback(
    (input) =>
      new Promise((resolve) => {
        if (!hasPlaces()) return resolve([]);
        try {
          const service = new window.google.maps.places.AutocompleteService();
          const bounds = new window.google.maps.LatLngBounds(
            { lat: TORONTO_BOUNDS.south, lng: TORONTO_BOUNDS.west },
            { lat: TORONTO_BOUNDS.north, lng: TORONTO_BOUNDS.east }
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
      }),
    [hasPlaces]
  );

  const getPlaceDetails = useCallback(
    (placeId) =>
      new Promise((resolve) => {
        if (!hasPlaces()) return resolve(null);
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
      }),
    [hasPlaces]
  );

  const panToPosition = useCallback((pos, zoom = 15) => {
    if (!mapRef.current || !pos) return;
    try {
      mapRef.current.panTo(pos);
      if (zoom) mapRef.current.setZoom(zoom);
    } catch (err) {
      console.warn("panTo failed", err);
    }
  }, []);

  // -----------------------------
  // Effects
  // -----------------------------
  useEffect(() => {
    if (mode === "add") {
      setInputValue("");
      setPredictions([]);
    }
  }, [mode]);

  // filtered events based on time window, category and distance
  const filteredEvents = React.useMemo(() => {
    const now = Date.now();
    const withinTime = (ev) => {
      if (!ev.ends_at) return true;
      const end = new Date(ev.ends_at).getTime();
      if (filterTime === "all") return end >= now;
      if (filterTime === "24h") return end >= now && end <= now + 24 * 3600 * 1000;
      if (filterTime === "7d") return end >= now && end <= now + 7 * 24 * 3600 * 1000;
      if (filterTime === "30d") return end >= now && end <= now + 30 * 24 * 3600 * 1000;
      return true;
    };

    const matchesCategory = (ev) => {
      if (!filterCategory) return true;
      return (ev.category || "").toLowerCase() === filterCategory.toLowerCase();
    };

    const withinDistance = (ev) => {
      if (!filterDistanceKm || filterDistanceKm <= 0) return true;
      const ref = center || userPos;
      if (!ref || !ev.position) return true;
      const R = 6371; // km
      const toRad = (v) => (v * Math.PI) / 180;
      const dLat = toRad(ev.position.lat - ref.lat);
      const dLon = toRad(ev.position.lng - ref.lng);
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(ref.lat)) *
          Math.cos(toRad(ev.position.lat)) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const d = R * c;
      return d <= Number(filterDistanceKm);
    };

    return (events || []).filter(
      (ev) => withinTime(ev) && matchesCategory(ev) && withinDistance(ev)
    );
  }, [events, filterTime, filterCategory, filterDistanceKm, center, userPos]);

  // debounced predictions

  useEffect(() => {
    // If in 'event' mode, derive predictions from the in-memory filtered events
    if (mode === "event") {
      if (!inputValue || inputValue.length < 1) {
        setPredictions([]);
        return;
      }
      const evs = (filteredEvents || [])
        .filter((e) => e.title && e.title.toLowerCase().includes(inputValue.toLowerCase()))
        .slice(0, 8)
        .map((e) => ({ eventId: e.id, description: e.title }));
      setPredictions(evs);
      return;
    }

    // For 'search' and 'add' modes use Google Places Autocomplete
    if (!mapLoaded || (mode !== "search" && mode !== "add")) return;
    if (!inputValue || inputValue.length < 2) {
      setPredictions([]);
      return;
    }
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
  }, [inputValue, mapLoaded, getPredictions, mode, filteredEvents]);

  // geolocation
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

  // when right panel opens ensure pan to selected
  useEffect(() => {
    if (!mapRef.current || !selectedEvent) return;
    const t = setTimeout(() => {
      try {
        mapRef.current.panTo(selectedEvent.position);
      } catch (err) {
        console.warn("panTo failed", err);
      }
    }, 320);
    return () => clearTimeout(t);
  }, [selectedEvent]);

  // compute map height
  useEffect(() => {
    function updateHeight() {
      if (!wrapperRef.current) return;
      const rect = wrapperRef.current.getBoundingClientRect();
      const GAP_PX = 16;
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

  // load events from server
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const rows = await fetchEvents();
        if (!mounted) return;
        const mapped = (rows || []).map((r) => ({
          id: r.id,
          title: r.title,
          description: r.description,
          position: {
            lat: Number(r.latitude),
            lng: Number(r.longitude),
          },
          location_address: r.location_address,
          starts_at: r.starts_at,
          ends_at: r.ends_at,
          user_id: r.user_id,
          category: r.category,
          img: r.data?.image?.url || null,
        }));
        setEvents(mapped);
      } catch (err) {
        console.warn("failed to load events", err);
        push({ type: "error", message: "Failed to load events", autoCloseMs: 5000 });
      }
    })();
    (async () => {
      try {
        const stats = await fetchTodaySummary();
        if (!mounted) return;
        if (!stats || !(stats.starting || stats.ending)) return;
        push({ type: "info", message: `There are ${stats.starting} events starting and ${stats.ending} events ending today.`, autoCloseMs: 10000 });
      } catch (err) {
        console.warn("failed to load today's summary", err);
      }
    })();
    return () => (mounted = false);
  }, []);

  // realtime socket listeners
  useEffect(() => {
    function onCreated(ev) {
      const mapped = {
        id: ev.id,
        title: ev.title,
        description: ev.description,
        position: { lat: Number(ev.latitude ?? ev.lat), lng: Number(ev.longitude ?? ev.lng) },
        location_address: ev.location_address,
        starts_at: ev.starts_at,
        img: ev.img || ev.data?.image?.url || null,
        ends_at: ev.ends_at,
        user_id: ev.user_id,
        category: ev.category ?? (ev.data && ev.data.category) ?? "",
      };
      setEvents((prev) => {
        if (prev.find((p) => String(p.id) === String(mapped.id))) return prev;
        return [...prev, mapped];
      });
    }
    function onUpdated(ev) {
      setEvents((prev) =>
        prev.map((p) =>
          String(p.id) === String(ev.id)
            ? {
                id: ev.id,
                title: ev.title,
                description: ev.description,
                position: {
                  lat: Number(ev.latitude),
                  lng: Number(ev.longitude),
                },
                location_address: ev.location_address,
                starts_at: ev.starts_at,
                ends_at: ev.ends_at,
                user_id: ev.user_id,
                category: ev.category,
                img: ev.img || ev.data?.image?.url || null,
              }
            : p
        )
      );
      setSelectedEvent((s) =>
        s && String(s.id) === String(ev.id)
          ? {
              ...s,
              title: ev.title,
              description: ev.description,
              position: {
                lat: Number(ev.latitude ?? s.position.lat),
                lng: Number(ev.longitude ?? s.position.lng),
              },
              location_address: ev.location_address,
              starts_at: ev.starts_at,
              ends_at: ev.ends_at,
              user_id: ev.user_id,
              img: ev.img || ev.data?.image?.url || null,
            }
          : s
      );
    }
    function onDeleted(payload) {
      setEvents((prev) => prev.filter((p) => String(p.id) !== String(payload.id)));
      setSelectedEvent((s) => (s && String(s.id) === String(payload.id) ? null : s));
      // if deleted event was in clusterEvents, remove it
      setClusterEvents((prev) => prev.filter((c) => String(c.id) !== String(payload.id)));
      if (clusterEvents.length && clusterIndex >= clusterEvents.length - 1) {
        setClusterIndex(0);
      }
    }

    socket.on("event:created", onCreated);
    socket.on("event:updated", onUpdated);
    socket.on("event:deleted", onDeleted);

    return () => {
      socket.off("event:created", onCreated);
      socket.off("event:updated", onUpdated);
      socket.off("event:deleted", onDeleted);
    };
  }, [clusterEvents, clusterIndex]);

  // -----------------------------
  // Handlers
  // -----------------------------
  const onMapLoad = useCallback((mapInstance) => {
    mapRef.current = mapInstance;
    setMapLoaded(true);
  }, []);

  // When clicking a cluster: collect its markers' event ids, find events, open panel and set pagination
  const onClusterClick = useCallback(
    (cluster) => {
      if (!cluster) return;
      const markers = cluster.getMarkers ? cluster.getMarkers() : [];
      // markers are google.maps.Marker MVCObjects - we stored eventId on marker via onLoad below
      const ids = markers
        .map((m) => {
          try {
            // prefer MVCObject.get if available, otherwise fallback to direct prop
            if (typeof m.get === "function") return m.get("eventId") ?? m.__eventId;
            return m.__eventId;
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      const clusterEv = ids
        .map((id) => filteredEvents.find((ev) => String(ev.id) === String(id)))
        .filter(Boolean);

      if (clusterEv.length === 0) return;

      // open EventInfo showing the first event in the cluster; set pagination
      setClusterEvents(clusterEv);
      setClusterIndex(0);
      setSelectedEvent(clusterEv[0]);

      // pan to cluster center (don't zoom — zoomOnClick disabled)
      const pos = cluster.getCenter();
      if (pos && typeof pos.lat === "function") {
        panToPosition({ lat: pos.lat(), lng: pos.lng() }, 15);
      } else if (pos && pos.lat && pos.lng) {
        panToPosition({ lat: pos.lat, lng: pos.lng }, 15);
      }
    },
    [filteredEvents, panToPosition]
  );

  // For single marker clicks - show that event and clear cluster browsing state
  const onMarkerClick = useCallback((ev) => {
    setClusterEvents([]);
    setClusterIndex(0);
    setSelectedEvent(ev);
  }, []);

  // utility to attach eventId to each Marker instance (so cluster.getMarkers can be mapped back)
  const markerOnLoad = useCallback((marker, id) => {
    try {
      if (typeof marker.set === "function") {
        marker.set("eventId", id);
      } else {
        marker.__eventId = id; // fallback
      }
    } catch {
      marker.__eventId = id;
    }
  }, []);

  // cluster pagination controls
  const showPrevInCluster = () => {
    if (!clusterEvents.length) return;
    const nextIndex = (clusterIndex - 1 + clusterEvents.length) % clusterEvents.length;
    setClusterIndex(nextIndex);
    setSelectedEvent(clusterEvents[nextIndex]);
  };
  const showNextInCluster = () => {
    if (!clusterEvents.length) return;
    const nextIndex = (clusterIndex + 1) % clusterEvents.length;
    setClusterIndex(nextIndex);
    setSelectedEvent(clusterEvents[nextIndex]);
  };

  // prediction select (open create modal)
  const handlePredictionSelect = async (p) => {
    if (!p) return;
    if (!user) {
      push({ type: "error", message: "Please sign in to create events", autoCloseMs: 5000 });
      return;
    }
    setPredictions([]);
    setInputValue(p.description);
    lastSelectedRef.current = p.description;
    const place = await getPlaceDetails(p.place_id);
    if (place && place.geometry) {
      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();
      const created = {
        location_address: place.formatted_address || p.description,
        latitude: lat,
        longitude: lng,
      };
      setInitialFormData(created);
      setShowModal(true);
      panToPosition({ lat, lng }, 15);
    }
  };

  // prediction select for search mode: pan to place (no modal)
  const handlePredictionPan = async (p) => {
    if (!p) return;
    setPredictions([]);
    setInputValue(p.description);
    lastSelectedRef.current = p.description;
    const place = await getPlaceDetails(p.place_id);
    if (place && place.geometry) {
      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();
      panToPosition({ lat, lng }, 15);
    }
  };

  const handleSearchButton = async () => {
    // If in search mode and the user already selected this same input, do nothing
    if (mode === "search" && lastSelectedRef.current && inputValue === lastSelectedRef.current) {
      return;
    }

    if (mode === "event") {
      if (!inputValue) return;
      const ev = filteredEvents.find((e) =>
        e.title.toLowerCase().includes(inputValue.toLowerCase())
      );
      if (ev) {
        setSelectedEvent(ev);
        panToPosition(ev.position, 15);
      } else {
        alert("No event found with that name");
      }
      return;
    }

    if (mode === "search") {
      const p = predictions?.[0];
      if (p) await handlePredictionPan(p);
      else alert("Please pick a location from the suggestions.");
      return;
    }

    // mode === 'add'
    if (!user) {
      alert("Please sign in to create events");
      return;
    }

    let p = predictions?.[0];
    if (!p && inputValue && inputValue.length > 0) {
      try {
        const preds = await getPredictions(inputValue);
        // try to find an exact-description match first, otherwise take first
        if (preds && preds.length) {
          p = preds.find((x) => x.description === inputValue) || preds[0];
        }
      } catch (err) {
        console.warn("failed to resolve place for add mode", err);
      }
    }

    if (p) {
      await handlePredictionSelect(p);
      return;
    }
  };

  // delete handler
  const handleDeleteEvent = async (id) => {
    if (!id) return;
    const before = events;
    const remaining = before.filter((e) => String(e.id) !== String(id));
    setEvents(remaining);
    setSelectedEvent(null);
    try {
      await deleteEvent(id);
      push({ type: "success", message: "Event deleted successfully!", autoCloseMs: 3000 });
    } catch (err) {
      console.error("failed to delete event", err);
      setEvents(before); // rollback
      push({ type: "error", message: "Failed to delete event. Changes have been reverted.", autoCloseMs: 5000 });
    }
  };

  const handleEditEvent = (ev) => {
    if (!ev) return;
    if (!user) {
      alert("Please sign in to edit events");
      return;
    }
    setInitialFormData({
      id: ev.id,
      title: ev.title,
      description: ev.description,
      latitude: ev.position?.lat,
      longitude: ev.position?.lng,
      location_address: ev.location_address,
      category: ev.category,
      starts_at: ev.starts_at,
      ends_at: ev.ends_at,
      img: ev.img || ev.data?.image?.url || null,
    });
    setShowModal(true);
  };

  // optimistic updates & rollback functions (kept similar to your original)
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
        position: {
          lat: Number(optimisticServerEvent.latitude ?? prevItem?.position?.lat),
          lng: Number(optimisticServerEvent.longitude ?? prevItem?.position?.lng),
        },
        location_address: optimisticServerEvent.location_address,
        starts_at: optimisticServerEvent.starts_at,
        ends_at: optimisticServerEvent.ends_at,
        user_id: optimisticServerEvent.user_id ?? prevItem?.user_id,
        category: optimisticServerEvent.category ?? (prevItem?.category || "Other"),
        img: optimisticServerEvent.img || optimisticServerEvent.data?.image?.url || prevItem?.img || null,
      };
      if (idx >= 0) {
        return prev.map((p) => (String(p.id) === String(id) ? mapped : p));
      }
      return [...prev, mapped];
    });
    setSelectedEvent((s) =>
      s && String(s.id) === String(optimisticServerEvent.id)
        ? {
            ...s,
            title: optimisticServerEvent.title,
            description: optimisticServerEvent.description,
            position: {
              lat: Number(optimisticServerEvent.latitude ?? s.position.lat),
              lng: Number(optimisticServerEvent.longitude ?? s.position.lng),
            },
            starts_at: optimisticServerEvent.starts_at,
            ends_at: optimisticServerEvent.ends_at,
            img: optimisticServerEvent.img || optimisticServerEvent.data?.image?.url || s.img || null,
            category: optimisticServerEvent.category ?? (s.category || "Other"),
          }
        : s
    );
  };

  const handleRollback = (originalData) => {
    if (!originalData || !originalData.id) return;
    const id = originalData.id;
    const prev = optimisticRef.current[id];
    if (prev) {
      setEvents((vals) => vals.map((v) => (String(v.id) === String(id) ? prev : v)));
      setSelectedEvent(prev);
      delete optimisticRef.current[id];
      push({ type: "error", message: "Update failed — changes rolled back", autoCloseMs: 5000 });
    }
  };

  // -----------------------------
  // Render
  // -----------------------------
  return (
    <div>
      <div className="mt-1 flex items-center gap-4">
        {/* Filter toggle */}
        <label className="flex cursor-pointer items-center gap-1">
          <input
            type="checkbox"
            defaultChecked
            className="toggle toggle-sm"
            onChange={() => setFilterOpen(!filterOpen)}
          />
          <span className="text-sm font-medium">Filter</span>
        </label>

        {/* Search toggle */}
        <label className="flex cursor-pointer items-center gap-1">
          <input
            type="checkbox"
            defaultChecked
            className="toggle toggle-sm"
            onChange={() => setSearchOpen(!searchOpen)}
          />
          <span className="text-sm font-medium">Search</span>
        </label>

        {/* Stats toggle */}
        <label className="flex cursor-pointer items-center gap-1">
          <input
            type="checkbox"
            defaultChecked
            className="toggle toggle-sm"
            onChange={() => setStatsOpen(!statsOpen)}
          />
          <span className="text-sm font-medium">Stats</span>
        </label>
      </div>

      <div
        className="relative mt-3 flex h-full w-full overflow-hidden"
        ref={wrapperRef}
        style={{ paddingBottom: "1rem" }}
      >
        {/* Map area (left) */}
        <div
          className={(selectedEvent ? "w-3/4" : "w-full") + " h-full transition-all duration-300"}
          style={{ minHeight: 400 }}
        >
          <GoogleMap
            mapContainerStyle={{ width: "100%", height: `${mapHeight}px` }}
            center={center}
            zoom={14}
            options={MAP_OPTIONS}
            onLoad={onMapLoad}
          >
            {/* Stats container */}
            {statsOpen && (
              <div className="bg-base-200/90 absolute bottom-4 right-4 rounded-lg p-2 shadow">
                <span className="text-sm font-medium">Total Events: {filteredEvents.length}</span>
              </div>
            )}
            {/* Filters container */}
            {filterOpen && (
              <div className="bg-base-200/90 absolute bottom-4 left-4 flex flex-col gap-3 rounded-lg p-2 shadow">
                {/* Time filter */}
                <div className="flex items-center justify-between gap-2">
                  <span className="w-32 text-sm font-medium">Time window:</span>
                  <select
                    value={filterTime}
                    onChange={(e) => setFilterTime(e.target.value)}
                    className="select select-sm flex-1"
                  >
                    <option value="all">All time</option>
                    <option value="24h">Ends 24h</option>
                    <option value="7d">Ends 7 days</option>
                    <option value="30d">Ends 30 days</option>
                  </select>
                </div>

                {/* Category filter */}
                <div className="flex items-center justify-between gap-2">
                  <span className="w-32 text-sm font-medium">Category:</span>
                  <select
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
                    className="select select-sm flex-1"
                  >
                    <option value="">All categories</option>
                    <option>Arts & Culture</option>
                    <option>Entertainment & Leisure</option>
                    <option>Education & Workshops</option>
                    <option>Sports & Fitness</option>
                    <option>Food & Drink</option>
                    <option>Business & Networking</option>
                    <option>Community & Social</option>
                    <option>Family & Kids</option>
                    <option>Technology & Innovation</option>
                    <option>Other</option>
                  </select>
                </div>

                {/* Max distance filter */}
                <div className="flex items-center justify-between gap-2">
                  <span className="w-32 text-sm font-medium">Max distance (km):</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={filterDistanceKm}
                      onChange={(e) =>
                        setFilterDistanceKm(e.target.value ? Number(e.target.value) : 0)
                      }
                      className="input input-sm w-16"
                    />
                  </div>
                </div>
              </div>
            )}
            {/* Search & Add controls */}
            {searchOpen && (
              <div className="absolute top-4 right-4 z-30 flex items-start gap-3">
                <div className="relative">
                  <div className="bg-base-200/90 relative flex items-center gap-2 rounded-full p-2 shadow">
                    <select
                      value={mode}
                      onChange={(e) => setMode(e.target.value)}
                      className="select select-sm select-ghost bg-base-200/90 rounded-full shadow-inner"
                    >
                      <option value="search">Search Location</option>
                      <option value="add">Add Event</option>
                      <option value="event">Search Event</option>
                    </select>

                    <label className="input relative flex items-center gap-2 rounded-full">
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
                        disabled={mode === "add" && !user}
                        placeholder={
                          mode === "add"
                            ? user
                              ? "Select location for new event"
                              : "Please login to add new event"
                            : mode === "event"
                              ? "Search event by name"
                              : "Search location"
                        }
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
                      onClick={handleSearchButton}
                      disabled={mode === "add" && !user}
                      title={mode === "add" && !user ? "Please login to create events" : ""}
                    >
                      {mode === "search" ? "Search" : mode === "add" ? "Add Event" : "Find Event"}
                    </button>
                  </div>

                  {/* Predictions dropdown */}
                  {predictions && predictions.length > 0 && (
                    <div className="absolute top-full left-0 z-50 mt-2 w-full">
                      <ul className="menu bg-base-100 rounded-box max-h-60 w-full overflow-auto p-2 shadow-sm">
                        {predictions.map((p) => (
                          <li key={p.eventId || p.place_id}>
                            <a
                              onClick={() => {
                                if (mode === "search") return handlePredictionPan(p);
                                if (mode === "add") return handlePredictionSelect(p);
                                if (mode === "event") {
                                  // clear dropdown after selecting an event prediction
                                  setPredictions([]);
                                  setInputValue(p.description);
                                  lastSelectedRef.current = p.description;
                                  const ev = filteredEvents.find(
                                    (e) => String(e.id) === String(p.eventId)
                                  );
                                  if (ev) {
                                    setSelectedEvent(ev);
                                    panToPosition(ev.position, 15);
                                  }
                                }
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
            )}

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
                  scaledSize: { width: 36, height: 36 },
                }}
              />
            )}

            {/* event markers with clusterer */}
            <MarkerClusterer options={CLUSTERER_OPTIONS} onClick={onClusterClick}>
              {(clusterer) =>
                filteredEvents.map((ev) => (
                  <Marker
                    key={ev.id}
                    position={ev.position}
                    title={ev.title}
                    clusterer={clusterer}
                    onLoad={(marker) => markerOnLoad(marker, ev.id)}
                    onClick={() => onMarkerClick(ev)}
                  />
                ))
              }
            </MarkerClusterer>
          </GoogleMap>

          {/* EventForm modal */}
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
                    const mapped = {
                      id: serverEvent.id,
                      title: serverEvent.title,
                      description: serverEvent.description,
                      position: {
                        lat: Number(serverEvent.latitude ?? initialFormData?.latitude),
                        lng: Number(serverEvent.longitude ?? initialFormData?.longitude),
                      },
                      location_address:
                        serverEvent.location_address ?? initialFormData?.location_address,
                      starts_at: serverEvent.starts_at ?? initialFormData?.starts_at,
                      ends_at: serverEvent.ends_at ?? initialFormData?.ends_at,
                      category: serverEvent.category ?? initialFormData?.category,
                      user_id: serverEvent.user_id,
                    };
                    setEvents((prev) => {
                      const found = prev.find((p) => String(p.id) === String(mapped.id));
                      if (found)
                        return prev.map((p) => (String(p.id) === String(mapped.id) ? mapped : p));
                      return [...prev, mapped];
                    });
                    setShowModal(false);
                    setSelectedEvent(mapped);
                    panToPosition(mapped.position, 15);
                    if (mapped?.id) delete optimisticRef.current[mapped.id];
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Right: Event Info + cluster pagination controls */}
        <aside
          className={
            "bg-base-100 absolute top-0 right-0 bottom-4 z-20 w-1/4 overflow-auto transition-transform duration-300 " +
            (selectedEvent ? "translate-x-0" : "translate-x-full")
          }
          aria-hidden={!selectedEvent}
        >
          <EventInfo
            event={selectedEvent}
            clusterEvents={clusterEvents}
            clusterIndex={clusterIndex}
            onPrevCluster={showPrevInCluster}
            onNextCluster={showNextInCluster}
            onClose={() => {
              setSelectedEvent(null);
              // clear cluster browsing when closing
              setClusterEvents([]);
              setClusterIndex(0);
            }}
            onEdit={handleEditEvent}
            onDelete={(id) => {
              // if deleting the currently browsed cluster item, remove it from clusterEvents too
              if (clusterEvents && clusterEvents.length) {
                setClusterEvents((prev) => prev.filter((c) => String(c.id) !== String(id)));
                if (clusterIndex >= clusterEvents.length - 1) setClusterIndex(0);
              }
              handleDeleteEvent(id);
            }}
          />
        </aside>
      </div>
    </div>
  );
}
