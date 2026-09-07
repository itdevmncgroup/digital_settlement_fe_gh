'use client';

interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  onSearch: () => void;
  placeholder?: string;
  style?: React.CSSProperties;
}

// Explicit search-on-click (not live/debounced): the input just tracks what's
// typed, onSearch() only fires on button click or Enter so the query (and
// whatever it filters - a backend call or a client-side row filter) doesn't
// re-run on every keystroke.
export default function SearchBox({ value, onChange, onSearch, placeholder, style }: SearchBoxProps) {
  return (
    <div style={{ display: 'flex', gap: 8, ...style }}>
      <input
        placeholder={placeholder ?? 'Search...'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSearch();
          }
        }}
        style={{ width: 260 }}
      />
      <button type="button" className="btn" onClick={onSearch}>
        Search
      </button>
    </div>
  );
}
