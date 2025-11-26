import React from "react";

export default function SearchInput({
  value,
  onChange,
  placeholder = "Search...",
  ariaLabel = "Search",
}) {
  return (
    <label className="input input-sm flex w-full items-center gap-2" aria-label={ariaLabel}>
      <svg className="h-4 opacity-60" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
        <g
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeWidth="2"
          fill="none"
          stroke="currentColor"
        >
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.3-4.3"></path>
        </g>
      </svg>
      <input
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 bg-transparent outline-none"
      />
    </label>
  );
}
