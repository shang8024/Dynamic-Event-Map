import React, { useState, useRef, useEffect } from "react";
import {
  LoadScript,
  GoogleMap,
  Marker,
  Autocomplete,
} from "@react-google-maps/api";
import EventForm from "../../components/EventForm";

const torontoBounds = {
  north: 43.855457,
  south: 43.581024,
  west: -79.639219,
  east: -79.115219,
};
const torontoCenter = { lat: 43.6532, lng: -79.3832 };

const containerStyle = {
  width: "100%",
  height: "100vh",
};

export default function EventMap() {
  const [markers, setMarkers] = useState([]);
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [mapCenter, setMapCenter] = useState(torontoCenter);
  const [modalOpen, setModalOpen] = useState(false);
  const [autocomplete, setAutocomplete] = useState(null);

  const mapRef = useRef();
  const dialogRef = useRef();

  // Auto center on user location if inside Toronto
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          if (
            latitude <= torontoBounds.north &&
            latitude >= torontoBounds.south &&
            longitude >= torontoBounds.west &&
            longitude <= torontoBounds.east
          ) {
            setMapCenter({ lat: latitude, lng: longitude });
          }
        },
        () => {}
      );
    }
  }, []);

  // Mock initial events
  const initialEvents = [
    {
      id: 1,
      title: "Basketball Game",
      description: "Enjoy the sunny day!",
      lat: 43.655,
      lng: -79.38,
    },
    {
      id: 2,
      title: "Food Festival",
      description: "Tasty treats!",
      lat: 43.66,
      lng: -79.375,
    },
  ];

  useEffect(() => {
    setMarkers(
      initialEvents.map((event) => ({
        id: event.id,
        title: event.title,
        position: { lat: event.lat, lng: event.lng },
      }))
    );
  }, []);

  useEffect(() => {
    if (modalOpen) {
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
    }
  }, [modalOpen]);

  const handleMapClick = async (e) => {
    const lat = e.latLng.lat();
    const lng = e.latLng.lng();
    if (
      lat <= torontoBounds.north &&
      lat >= torontoBounds.south &&
      lng >= torontoBounds.west &&
      lng <= torontoBounds.east
    ) {
      const geocoder = new window.google.maps.Geocoder();
      const res = await geocoder.geocode({ location: { lat, lng } });
      const address = res.results[0]?.formatted_address || "";
      setSelectedPosition({ lat, lng, address });
      setModalOpen(true);
    } else {
      alert("You can only create events within Toronto.");
    }
  };

  const handleSaved = (newEvent) => {
    setMarkers([
      ...markers,
      { ...newEvent, position: { lat: newEvent.lat, lng: newEvent.lng } },
    ]);
    setModalOpen(false);
  };

  const handlePlaceChanged = () => {
    if (!autocomplete) return;
    const place = autocomplete.getPlace();
    if (!place.geometry) return;

    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();

    if (
      lat <= torontoBounds.north &&
      lat >= torontoBounds.south &&
      lng >= torontoBounds.west &&
      lng <= torontoBounds.east
    ) {
      setMapCenter({ lat, lng });
    } else {
      alert("Only Toronto addresses are allowed.");
    }
  };

  return (
    <LoadScript
      googleMapsApiKey={import.meta.env.VITE_GOOGLE_MAPS_KEY}
      libraries={["places"]}
    >
      <div className="relative">
        {/* Search + Add Event Button */}
        <div className="absolute top-4 right-4 z-50 flex gap-2">
          <Autocomplete
            onLoad={(auto) => setAutocomplete(auto)}
            onPlaceChanged={handlePlaceChanged}
            options={{
              bounds: torontoBounds,
              strictBounds: true,
              componentRestrictions: { country: "ca" },
            }}
          >
            <input
              type="text"
              placeholder="Search Toronto address"
              className="input input-bordered w-72"
            />
          </Autocomplete>

          <button
            className="btn btn-primary"
            onClick={() => setModalOpen(true)}
          >
            Add Event
          </button>
        </div>

        {/* Google Map */}
        <GoogleMap
          mapContainerStyle={containerStyle}
          center={mapCenter}
          zoom={12}
          onClick={handleMapClick}
          options={{
            restriction: { latLngBounds: torontoBounds, strictBounds: true },
          }}
          onLoad={(map) => (mapRef.current = map)}
        >
          {markers.map((m) => (
            <Marker key={m.id} position={m.position} title={m.title} />
          ))}
        </GoogleMap>

        {/* Only one <dialog> in EventMap */}
        <dialog ref={dialogRef} className="modal">
          <div className="modal-box">
            <EventForm
              initialData={selectedPosition || {}}
              onSaved={handleSaved}
              onCancel={() => setModalOpen(false)}
            />
          </div>
        </dialog>
      </div>
    </LoadScript>
  );
}
