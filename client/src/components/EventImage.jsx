import React from "react";
import {eventImage} from "../utils/event";
import EventArtwork from "./EventArtwork.jsx";
import {scheduleSummary} from '../utils/event';

export default function EventImage({ event, className,showDates=true }) {
  if (!event) return null;

  const image = eventImage(event);
  const when=scheduleSummary(event);

  const imageWrapperClass = className || "aspect-[4/3] w-40 flex-none md:w-56";

  return (
    <div className="w-full min-w-0 md:w-auto">
      <div className={imageWrapperClass}>
        <EventArtwork src={image?.url} alt={image?.alt} category={event.category || event._row?.category} title={event.title} className="h-full w-full rounded" />
      </div>

      {showDates&&<div className="muted mt-2 text-xs"><strong>{when.label}:</strong> {when.text}</div>}
    </div>
  );
}
