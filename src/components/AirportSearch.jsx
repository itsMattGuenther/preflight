import { Clock, Home, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { normalizeAirportCode } from '../hooks/useRoute';

// Search by identifier, airport name, or city. The index (~17k US airports
// from OurAirports) is fetched the first time the box is focused, so it never
// slows down the initial page load.
let indexPromise = null;
function loadIndex() {
  if (!indexPromise) {
    indexPromise = fetch('/data/airports-search.json')
      .then((res) => (res.ok ? res.json() : []))
      .catch(() => {
        indexPromise = null;
        return [];
      });
  }
  return indexPromise;
}

function search(index, query) {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const words = q.split(/[\s,/-]+/).filter(Boolean);
  const results = [];
  for (const [id, local, name, city, state, rank] of index) {
    let score = null;
    if (id === q || local === q || id === `K${q}`) score = 0;
    else if (id.startsWith(q) || local.startsWith(q)) score = 1;
    else {
      const haystack = `${name} ${city} ${state}`.toUpperCase().split(/[\s,/()-]+/);
      if (words.every((word) => haystack.some((part) => part.startsWith(word)))) score = 2;
    }
    if (score != null) results.push({ id, local, name, city, state, score, rank });
  }
  return results.sort((a, b) => a.score - b.score || a.rank - b.rank || a.id.localeCompare(b.id)).slice(0, 8);
}

export function AirportSearch({ onSelect, recents = [], home = null, size = 'compact', autoFocus = false, placeholder }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listId = useId();

  useEffect(() => {
    // "/" jumps to search from anywhere, like many web apps.
    if (size !== 'compact') return undefined;
    const onKey = (event) => {
      if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [size]);

  const results = useMemo(() => (index ? search(index, query) : []), [index, query]);
  const quickPicks = useMemo(() => {
    const list = [];
    if (home) list.push({ id: home, label: 'Home airport', icon: Home });
    recents.filter((code) => code !== home).slice(0, 5).forEach((code) => list.push({ id: code, label: 'Recent', icon: Clock }));
    return list;
  }, [home, recents]);
  const options = query.trim() ? results : quickPicks;

  function choose(code) {
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
    onSelect(code);
  }

  function onSubmit(event) {
    event.preventDefault();
    if (open && options[active]) return choose(options[active].id);
    const code = normalizeAirportCode(query);
    if (code.length >= 3) choose(code);
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((value) => Math.min(value + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((value) => Math.max(value - 1, 0));
    } else if (event.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  return (
    <form className={`airport-search ${size}`} onSubmit={onSubmit} role="search">
      <Search size={size === 'large' ? 20 : 16} aria-hidden="true" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          loadIndex().then(setIndex);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        placeholder={placeholder || 'Airport ID, name or city'}
        aria-label="Search airports by identifier, name or city"
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
        enterKeyHint="search"
        autoFocus={autoFocus}
      />
      {size === 'compact' ? <kbd className="search-kbd" aria-hidden="true">/</kbd> : <button type="submit" className="primary-button">Brief me</button>}
      {open && options.length > 0 ? (
        <ul className="search-results" id={listId} role="listbox">
          {options.map((option, index) => (
            <li key={`${option.id}-${index}`} role="option" aria-selected={index === active}>
              <button
                type="button"
                className={index === active ? 'active' : ''}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option.id)}
                onMouseEnter={() => setActive(index)}
              >
                <span className="search-id">{option.id}</span>
                {option.name ? (
                  <span className="search-name">
                    {option.name}
                    <small>{[option.city, option.state].filter(Boolean).join(', ')}{option.local ? ` · ${option.local}` : ''}</small>
                  </span>
                ) : (
                  <span className="search-name muted">
                    {option.icon ? <option.icon size={12} /> : null} {option.label}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
