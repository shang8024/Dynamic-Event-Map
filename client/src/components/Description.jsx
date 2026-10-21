import React, { useRef, useState, useLayoutEffect } from "react";
function Description({ text }) {
  const pRef = useRef(null);
  const [expanded, setExpanded] = useState(false);
  const [collapsedMax, setCollapsedMax] = useState(40);
  const [hasOverflow, setHasOverflow] = useState(false);
  useLayoutEffect(() => {
    const el = pRef.current;
    if (!el) return;
    const compute = () => {
      const cs = getComputedStyle(el);
      const lh = parseFloat(cs.lineHeight) || 20;
      const limit = Math.round(lh * 3);
      setCollapsedMax(limit);
      setHasOverflow(el.scrollHeight > limit + 1);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);
  return (
    <div className="muted mt-2 text-sm">
      <div
        className="relative"
        style={{ maxHeight: expanded ? "none" : `${collapsedMax}px`, overflow: "hidden" }}
      >
        <p ref={pRef}>{text}</p>
        {!expanded && hasOverflow && (
          <div className="from-base-200 pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t to-transparent" />
        )}
      </div>
      {hasOverflow && (
        <button
          className="link text-primary inline-flex min-h-11 items-center text-sm"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          aria-label={expanded ? "Show less" : "Show more"}
          aria-expanded={expanded}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export default Description;
