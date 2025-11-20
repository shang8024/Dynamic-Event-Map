import React, { useRef, useState, useLayoutEffect } from "react";
function Description({ text, valid = true }) {
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
    <div className="mt-1 text-sm text-base-content/60">
      <div className="relative" style={{maxHeight: expanded ? "none" : `${collapsedMax}px`, overflow: "hidden"}}>
        <p ref={pRef}>{text}</p>
        {!expanded && hasOverflow && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-base-200 to-transparent" />
        )}
      </div>
      {hasOverflow && (
        <button
          className="mt-2 text-xs text-primary underline opacity-80 hover:opacity-100"
          disabled={!valid}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          aria-label={expanded ? "Show less" : "Show more"}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export default Description;