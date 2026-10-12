import React, { useLayoutEffect, useRef, useState } from 'react';
import CvDocument from './CvDocument.jsx';
import { domPrimitives, A4_WIDTH_PX, A4_HEIGHT_PX } from './domPrimitives.jsx';

// Module 4 — live HTML preview of the CV at A4 width, scaled to fit its
// container. Renders the same CvDocument tree as the PDF export.
// Page boundaries are approximate here; "Preview PDF" shows exact pagination.

export default function CvPreview({ data, settings, template }) {
  const wrapRef = useRef(null);
  const sheetRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(A4_HEIGHT_PX);

  useLayoutEffect(() => {
    const update = () => {
      if (wrapRef.current) setScale(Math.min(1, wrapRef.current.clientWidth / A4_WIDTH_PX));
      if (sheetRef.current) setHeight(sheetRef.current.offsetHeight);
    };
    update();
    const ro = new ResizeObserver(update);
    if (wrapRef.current) ro.observe(wrapRef.current);
    if (sheetRef.current) ro.observe(sheetRef.current);
    return () => ro.disconnect();
  }, []);

  // Small tolerance: the sheet's min-height is one A4 page, and rounding can
  // make it a fraction of a pixel taller.
  const pages = Math.max(1, Math.ceil((height - 2) / A4_HEIGHT_PX));

  return (
    <div ref={wrapRef} className="w-full">
      <div style={{ height: height * scale, position: 'relative' }}>
        <div
          ref={sheetRef}
          className="shadow-lg ring-1 ring-slate-200 absolute top-0 left-0"
          style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: A4_WIDTH_PX }}
        >
          <CvDocument P={domPrimitives} data={data} settings={settings} template={template} />
          {/* Approximate page-break guides */}
          {Array.from({ length: pages - 1 }, (_, i) => (
            <div
              key={i}
              className="absolute left-0 right-0 border-t-2 border-dashed border-rose-300 pointer-events-none"
              style={{ top: (i + 1) * A4_HEIGHT_PX }}
            >
              <span className="absolute right-2 -top-5 text-[11px] font-medium text-rose-400 bg-white px-1">
                ≈ page {i + 2}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
