"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  ApiError,
  CitySuggestion,
  CityZone,
  resolveServiceCity,
  ServiceCity,
  suggestServiceCities,
} from "@/lib/api";
import { US_STATE_CODES, US_STATES } from "@/lib/constants";
import ServiceTerritoryMap from "@/components/schedule/ServiceTerritoryMap";

const STATE_NAME_BY_CODE: Record<string, string> = Object.fromEntries(
  US_STATES.map((name) => [US_STATE_CODES[name], name]),
);

function sameCity(a: ServiceCity, b: ServiceCity): boolean {
  return (
    a.placeId === b.placeId ||
    (a.state === b.state && a.city.toLowerCase() === b.city.toLowerCase())
  );
}

function StateCityGroup({
  stateCode,
  cities,
  token,
  onAdd,
  onRemoveCity,
  onRemoveState,
}: {
  stateCode: string;
  cities: ServiceCity[];
  token: string | null;
  onAdd: (city: ServiceCity) => boolean;
  onRemoveCity: (placeId: string) => void;
  onRemoveState: () => void;
}) {
  const listId = useId();
  const stateName = STATE_NAME_BY_CODE[stateCode] ?? stateCode;
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<CitySuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!token || q.length < 2) return;

    let cancelled = false;
    const handle = window.setTimeout(() => {
      setSearching(true);
      setMessage(null);
      void suggestServiceCities(token, q, stateCode)
        .then((result) => {
          if (cancelled) return;
          setSuggestions(result.suggestions);
          setOpen(true);
          setSearched(true);
        })
        .catch((err) => {
          if (cancelled) return;
          setSuggestions([]);
          setSearched(true);
          setMessage(
            err instanceof ApiError ? err.message : "City search failed.",
          );
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, stateCode, token]);

  async function choose(suggestion: CitySuggestion) {
    if (!token || adding) return;
    setAdding(true);
    setMessage(null);
    setOpen(false);
    try {
      const { city } = await resolveServiceCity(
        token,
        suggestion.placeId,
        stateCode,
      );
      const added = onAdd(city);
      if (!added) {
        setMessage("Already added.");
        return;
      }
      setQuery("");
      setSuggestions([]);
      setSearched(false);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Could not add that city.");
    } finally {
      setAdding(false);
    }
  }

  const inState = cities.filter((city) => city.state === stateCode);

  return (
    <div className="rounded-md border border-neutral-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-brand-dark">{stateName}</p>
        <button
          type="button"
          onClick={onRemoveState}
          className="text-xs text-neutral-500 hover:text-red-600"
        >
          Remove state
        </button>
      </div>

      {inState.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {inState.map((city) => (
            <li key={city.placeId}>
              <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
                {city.city}
                <button
                  type="button"
                  onClick={() => onRemoveCity(city.placeId)}
                  className="rounded-full text-neutral-400 hover:text-neutral-700"
                  aria-label={`Remove ${city.city}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="relative mt-2">
        <input
          value={query}
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={`City in ${stateName}`}
          disabled={!token || adding}
          placeholder={adding ? "Adding city…" : "Search cities"}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            setMessage(null);
            if (next.trim().length < 2) {
              setSuggestions([]);
              setSearching(false);
              setSearched(false);
              setOpen(false);
            }
          }}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const first = suggestions[0];
              if (first) void choose(first);
            }
            if (e.key === "Escape") setOpen(false);
          }}
          className="block w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange disabled:opacity-60"
        />
        {open && suggestions.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-neutral-200 bg-white py-1 shadow-lg"
          >
            {suggestions.map((suggestion) => (
              <li key={suggestion.placeId} role="option" aria-selected={false}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void choose(suggestion)}
                  className="block w-full px-3 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-50"
                >
                  {suggestion.label || `${suggestion.city}, ${suggestion.state}`}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {searching && <p className="mt-1 text-xs text-neutral-400">Searching…</p>}
      {!searching && searched && suggestions.length === 0 && !message && (
        <p className="mt-1 text-xs text-neutral-400">
          No matching cities in {stateName}.
        </p>
      )}
      {message && <p className="mt-1 text-xs text-neutral-500">{message}</p>}
    </div>
  );
}

export default function ServiceTerritoryField({
  token,
  cities,
  onChange,
}: {
  token: string | null;
  cities: ServiceCity[];
  onChange: (cities: ServiceCity[]) => void;
}) {
  const [extraStates, setExtraStates] = useState<string[]>([]);
  const [pendingState, setPendingState] = useState("");
  const [pickedState, setPickedState] = useState<string | null>(null);

  const states = useMemo(() => {
    const ordered: string[] = [];
    for (const city of cities) {
      if (city.state && !ordered.includes(city.state)) ordered.push(city.state);
    }
    for (const state of extraStates) {
      if (!ordered.includes(state)) ordered.push(state);
    }
    return ordered;
  }, [cities, extraStates]);

  const activeState =
    pickedState && states.includes(pickedState) ? pickedState : (states[0] ?? null);

  const availableStates = US_STATES.filter(
    (name) => !states.includes(US_STATE_CODES[name]),
  );

  const citiesRef = useRef(cities);
  useEffect(() => {
    citiesRef.current = cities;
  }, [cities]);

  function addCity(city: ServiceCity): boolean {
    const current = citiesRef.current;
    if (current.some((existing) => sameCity(existing, city))) return false;
    const next = [...current, city];
    citiesRef.current = next;
    onChange(next);
    return true;
  }

  function removeCity(placeId: string) {
    const next = citiesRef.current.filter((city) => city.placeId !== placeId);
    citiesRef.current = next;
    onChange(next);
  }

  async function addCityFromZone(zone: CityZone) {
    if (!token) throw new Error("Sign in to add cities.");
    const wanted = zone.name.trim().toLowerCase();
    if (
      citiesRef.current.some(
        (city) =>
          city.state === zone.state && city.city.trim().toLowerCase() === wanted,
      )
    ) {
      return;
    }
    try {
      const { suggestions } = await suggestServiceCities(token, zone.name, zone.state);
      const match = suggestions.find(
        (suggestion) => suggestion.city.trim().toLowerCase() === wanted,
      );
      if (match) {
        const { city } = await resolveServiceCity(token, match.placeId, zone.state);
        if (city.city.trim().toLowerCase() === wanted) {
          addCity(city);
          return;
        }
      }
    } catch (err) {
      if (!zone.geoid) throw err;
    }
    if (!zone.geoid) {
      throw new Error(`Could not match ${zone.name} to a Google city.`);
    }
    addCity({
      city: zone.name,
      state: zone.state,
      placeId: `census:${zone.geoid}`,
      lat: zone.lat,
      lng: zone.lng,
    });
  }

  function addState() {
    if (!pendingState || states.includes(pendingState)) return;
    setExtraStates((current) => [...current, pendingState]);
    setPickedState(pendingState);
    setPendingState("");
  }

  function removeState(stateCode: string) {
    setExtraStates((current) => current.filter((state) => state !== stateCode));
    const next = citiesRef.current.filter((city) => city.state !== stateCode);
    citiesRef.current = next;
    onChange(next);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="shrink-0">
        <p className="text-xs font-medium text-neutral-600">Territory</p>
        <p className="mt-0.5 text-xs text-neutral-400">
          Add a state, then click a city area or pick a suggestion so the city
          matches Google. The scheduler can use this list later.
        </p>
      </div>

      <ServiceTerritoryMap
        states={states}
        activeState={activeState}
        cities={cities}
        onAddCity={addCity}
        onAddCityFromZone={addCityFromZone}
        onRemoveCity={removeCity}
        onActiveStateChange={setPickedState}
      />

      <div className="shrink-0 space-y-2 xl:max-h-44 xl:overflow-y-auto">
        {states.length === 0 && (
          <p className="text-xs text-neutral-400">No cities yet.</p>
        )}
        {states.map((stateCode) => (
          <StateCityGroup
            key={stateCode}
            stateCode={stateCode}
            cities={cities}
            token={token}
            onAdd={addCity}
            onRemoveCity={removeCity}
            onRemoveState={() => removeState(stateCode)}
          />
        ))}
      </div>

      <div className="flex shrink-0 gap-2">
        <select
          value={pendingState}
          onChange={(e) => setPendingState(e.target.value)}
          aria-label="State to add"
          className="min-w-0 flex-1 rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange"
        >
          <option value="">Add a state…</option>
          {availableStates.map((name) => (
            <option key={name} value={US_STATE_CODES[name]}>
              {name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!pendingState}
          onClick={addState}
          className="rounded-md border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  );
}
