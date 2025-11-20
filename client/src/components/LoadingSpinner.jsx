import React from "react";

export default function LoadingSpinner() {
  return (
    <div className="card bg-base-100">
      <div className="card-body">
        <div className="flex items-center justify-center py-8">
          <span className="loading loading-spinner loading-lg" />
        </div>
      </div>
    </div>
  );
}
