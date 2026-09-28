'use client';

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

// Map (OpenStreetMap tiles) to fine-tune a "lat, lng" location: tap the map or
// drag the pin. `value` is the same "lat, lng" string stored on Expense.location.
// Leaflet touches `window`, so it's imported inside the effect (client only).

const DEFAULT_CENTER: [number, number] = [-6.2088, 106.8456]; // Jakarta

export function parseLatLng(value: string): [number, number] | null {
  const m = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
}

export default function LocationPicker({ value, onChange, height = 260 }: { value: string; onChange: (v: string) => void; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<{ setPoint: (p: [number, number]) => void } | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const initial = useRef(value);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    import('leaflet').then((L) => {
      if (disposed || !el.current) return;
      const start = parseLatLng(initial.current);
      const map = L.map(el.current).setView(start ?? DEFAULT_CENTER, start ? 16 : 11);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }).addTo(map);
      // divIcon avoids Leaflet's default marker PNGs, which bundlers can't resolve.
      const icon = L.divIcon({
        className: '',
        html: '<div style="font-size:30px;line-height:30px;transform:translate(-50%,-100%)">📍</div>',
        iconSize: [0, 0],
      });
      let marker: import('leaflet').Marker | null = null;
      const fmt = (p: { lat: number; lng: number }) => `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
      const place = (p: [number, number]) => {
        if (marker) {
          marker.setLatLng(p);
          return;
        }
        marker = L.marker(p, { icon, draggable: true }).addTo(map);
        marker.on('dragend', () => onChangeRef.current(fmt(marker!.getLatLng())));
      };
      if (start) place(start);
      map.on('click', (e) => {
        place([e.latlng.lat, e.latlng.lng]);
        onChangeRef.current(fmt(e.latlng));
      });
      api.current = {
        setPoint: (p) => {
          place(p);
          map.setView(p, Math.max(map.getZoom(), 16));
        },
      };
      // Value may have changed (auto-detected location) while Leaflet was loading.
      const latest = parseLatLng(valueRef.current);
      if (latest) api.current.setPoint(latest);
      // Container may still be laying out when created inside a card.
      setTimeout(() => map.invalidateSize(), 0);
      cleanup = () => map.remove();
    });
    return () => {
      disposed = true;
      api.current = null;
      cleanup();
    };
  }, []);

  // Keep the pin in sync when the text field / "use my location" changes value.
  useEffect(() => {
    const p = parseLatLng(value);
    if (p) api.current?.setPoint(p);
  }, [value]);

  // isolation: 'isolate' pins Leaflet's own internal stacking (tile/marker
  // panes, zoom + attribution controls all use z-index up to 1000 in
  // leaflet.css) inside this box - without it, since leaflet.css never sets a
  // z-index on .leaflet-container itself, those layers compare directly
  // against the page's fixed bottom-nav/submit bar (z-index 25/30) in the
  // shared root stacking context and paint over them despite being nested
  // visually inside a small card.
  return (
    <div
      ref={el}
      style={{ height, width: '100%', borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden', position: 'relative', isolation: 'isolate' }}
    />
  );
}
