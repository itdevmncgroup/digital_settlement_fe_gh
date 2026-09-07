'use client';

import { PointerEvent as ReactPointerEvent, useRef, useState } from 'react';

interface ZoomableImageProps {
  src: string;
  alt: string;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const STEP = 0.5;

// Zoom only via the +/- buttons (never the mouse wheel - the wheel is left as
// plain vertical scroll/pan of the container, which also works at any zoom
// level, even 100% when the image is already taller than the viewport).
// Left-click-and-drag pans too. Used inside the invoice preview popup so a
// photographed receipt stays readable at full size.
export default function ZoomableImage({ src, alt }: ZoomableImageProps) {
  const [scale, setScale] = useState(1);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);

  const zoomIn = () => setScale((s) => Math.min(MAX_SCALE, s + STEP));
  const zoomOut = () => setScale((s) => Math.max(MIN_SCALE, s - STEP));
  const reset = () => setScale(1);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = containerRef.current;
    if (!el) return;
    dragStart.current = { x: e.clientX, y: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop };
    setDragging(true);
    el.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el || !dragStart.current) return;
    el.scrollLeft = dragStart.current.scrollLeft - (e.clientX - dragStart.current.x);
    el.scrollTop = dragStart.current.scrollTop - (e.clientY - dragStart.current.y);
  };

  const endDrag = () => {
    dragStart.current = null;
    setDragging(false);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
        <button type="button" className="btn" onClick={zoomOut} disabled={scale <= MIN_SCALE} aria-label="Zoom out">
          − Zoom Out
        </button>
        <button type="button" className="btn" onClick={zoomIn} disabled={scale >= MAX_SCALE} aria-label="Zoom in">
          + Zoom In
        </button>
        <button type="button" className="btn" onClick={reset} disabled={scale === 1}>
          Reset
        </button>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{Math.round(scale * 100)}%</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>· Klik kiri tahan untuk geser</span>
      </div>
      <div
        ref={containerRef}
        style={{
          border: '1px solid var(--border)',
          borderRadius: 6,
          overflow: 'auto',
          maxHeight: '65vh',
          background: 'var(--input-bg)',
          cursor: dragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          touchAction: 'none',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerCancel={endDrag}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={{
            width: `${scale * 100}%`,
            maxWidth: 'none',
            display: 'block',
            transition: 'width 0.15s ease',
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
}
