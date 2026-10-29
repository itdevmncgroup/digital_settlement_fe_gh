'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export interface PartyOption {
  id: string;
  name: string;
}
export interface BrandPartyOption extends PartyOption {
  advertiserId: string;
}

export interface ClientParties {
  agencies: PartyOption[];
  advertisers: PartyOption[];
  brands: BrandPartyOption[];
}

export const EMPTY_PARTIES: ClientParties = { agencies: [], advertisers: [], brands: [] };

function Chips({ items, onRemove }: { items: PartyOption[]; onRemove: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
      {items.map((o) => (
        <span key={o.id} className="badge badge-info" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, padding: '6px 10px' }}>
          {o.name}
          <button type="button" onClick={() => onRemove(o.id)} aria-label={`Remove ${o.name}`} style={{ border: 'none', background: 'none', color: 'inherit', fontSize: 18, lineHeight: 1, padding: 0, cursor: 'pointer' }}>
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

function AddSelect({ options, placeholder, onPick, style }: { options: PartyOption[]; placeholder: string; onPick: (id: string) => void; style: React.CSSProperties }) {
  return (
    <select value="" onChange={(e) => e.target.value && onPick(e.target.value)} style={style} disabled={options.length === 0}>
      <option value="">{options.length === 0 ? 'No more options' : placeholder}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

// Agency / Advertiser (at least one of the two is required - validated by the caller) / Brand (optional), each multi-select.
// Brand options follow the picked Advertisers (a Brand belongs to exactly one).
// `compact` is for a multi-column layout (the desktop Create popup): short single-line labels and the
// dropdown above its chips, so the three controls line up across columns however many are picked.
export default function ClientPartiesPicker({
  value,
  onChange,
  style,
  compact,
}: {
  value: ClientParties;
  onChange: (v: ClientParties) => void;
  style: React.CSSProperties;
  compact?: boolean;
}) {
  const [agencies, setAgencies] = useState<PartyOption[]>([]);
  const [advertisers, setAdvertisers] = useState<PartyOption[]>([]);
  const [brands, setBrands] = useState<BrandPartyOption[]>([]);

  useEffect(() => {
    api.get<PartyOption[]>('/agencies?active=true').then(setAgencies).catch(() => undefined);
    api.get<PartyOption[]>('/advertisers?active=true').then(setAdvertisers).catch(() => undefined);
  }, []);

  const advertiserIds = value.advertisers.map((a) => a.id).join(',');
  useEffect(() => {
    if (!advertiserIds) {
      setBrands([]);
      return;
    }
    api.get<BrandPartyOption[]>(`/brands?advertiserIds=${advertiserIds}&active=true`).then(setBrands).catch(() => undefined);
  }, [advertiserIds]);

  const toggleBrand = (b: BrandPartyOption) =>
    onChange({ ...value, brands: value.brands.some((s) => s.id === b.id) ? value.brands.filter((s) => s.id !== b.id) : [...value.brands, b] });

  return (
    <>
      <div className="form-row">
        <label>{compact ? 'Agency' : 'Agency (wajib isi Agency atau Advertiser, boleh keduanya)'}</label>
        {!compact && <Chips items={value.agencies} onRemove={(id) => onChange({ ...value, agencies: value.agencies.filter((a) => a.id !== id) })} />}
        <AddSelect
          placeholder="Add agency..."
          options={agencies.filter((a) => !value.agencies.some((s) => s.id === a.id))}
          onPick={(id) => {
            const a = agencies.find((x) => x.id === id);
            if (a) onChange({ ...value, agencies: [...value.agencies, a] });
          }}
          style={style}
        />
        {compact && <div style={{ marginTop: 8 }}><Chips items={value.agencies} onRemove={(id) => onChange({ ...value, agencies: value.agencies.filter((a) => a.id !== id) })} /></div>}
      </div>

      <div className="form-row">
        <label>{compact ? 'Advertiser' : 'Advertiser (wajib isi Agency atau Advertiser, boleh keduanya)'}</label>
        {!compact && (
          <Chips
            items={value.advertisers}
            onRemove={(id) => onChange({ ...value, advertisers: value.advertisers.filter((a) => a.id !== id), brands: value.brands.filter((b) => b.advertiserId !== id) })}
          />
        )}
        <AddSelect
          placeholder="Add advertiser..."
          options={advertisers.filter((a) => !value.advertisers.some((s) => s.id === a.id))}
          onPick={(id) => {
            const a = advertisers.find((x) => x.id === id);
            if (a) onChange({ ...value, advertisers: [...value.advertisers, a] });
          }}
          style={style}
        />
        {compact && (
          <div style={{ marginTop: 8 }}>
            <Chips
              items={value.advertisers}
              onRemove={(id) => onChange({ ...value, advertisers: value.advertisers.filter((a) => a.id !== id), brands: value.brands.filter((b) => b.advertiserId !== id) })}
            />
          </div>
        )}
      </div>

      <div className="form-row">
        <label>{compact ? 'Brand' : 'Brand (optional, can pick more than one)'}</label>
        {value.advertisers.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Pick an advertiser first</div>
        ) : brands.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>No brands for the selected advertiser(s)</div>
        ) : (
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, maxHeight: compact ? 160 : 220, overflowY: 'auto' }}>
            {value.advertisers.map((adv) => {
              const list = brands.filter((b) => b.advertiserId === adv.id);
              if (list.length === 0) return null;
              return (
                <div key={adv.id}>
                  <div style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, color: 'var(--muted)', background: 'var(--surface-2)' }}>{adv.name}</div>
                  {list.map((b) => (
                    <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: '0 12px', margin: 0 }}>
                      <input type="checkbox" checked={value.brands.some((s) => s.id === b.id)} onChange={() => toggleBrand(b)} style={{ width: 20, height: 20 }} />
                      {b.name}
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
        )}
        {value.brands.length > 0 && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{value.brands.length} selected</div>}
      </div>
    </>
  );
}
