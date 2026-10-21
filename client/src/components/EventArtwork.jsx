import { useState } from "react";

// Missing/broken event artwork uses a local asset, without a paid map request.
export default function EventArtwork({ src, title, className = "" }) {
  const [failedSource, setFailedSource] = useState(null);
  const hasImage = Boolean(src && src !== failedSource);

  return (
    <img
      src={hasImage ? src : "/logo.png"}
      alt={hasImage ? title || "Event" : "Event image unavailable"}
      className={`${className} ${hasImage ? "object-cover" : "bg-base-200 object-contain p-6"}`}
      onError={() => {
        if (hasImage) setFailedSource(src);
      }}
    />
  );
}
