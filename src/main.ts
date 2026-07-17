import './styles.css';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { GUIDE_YEAR, loadLiveCatalogue } from './data';
import type { LiveCity, Venue, VenueAward } from './data';
import {
  CITIES,
  GLOBAL_META_DESCRIPTION,
  GLOBAL_META_TITLE,
  cityBySlug,
  citySlugFromUrl,
} from './cities';
import type { CityConfig, CitySlug } from './cities';
import { bindCommunity, communityControl, communityPanel } from './community';

/** '' = all award levels; otherwise a literal level label present in the loaded data. */
type Filter = string;
type DataMode = 'loading' | 'live' | 'error';

interface UserLocation {
  lat: number;
  lng: number;
}

interface State {
  mode: DataMode;
  /** Active city route; null renders the city chooser. */
  city: CitySlug | null;
  /** Public city records loaded with the catalogue; static configs only supply presentation metadata. */
  cities: LiveCity[];
  /** Every loaded place, across all cities. Never rendered directly — see cityVenues(). */
  venues: Venue[];
  filter: Filter;
  /** '' = all sources; otherwise a source name present in the loaded data. */
  sourceFilter: string;
  /** '' = all categories; otherwise a venue category present in the loaded data (e.g. 'Pizza', 'Coffee'). */
  categoryFilter: string;
  selectedId: string | null;
  /** Whether the last selection came from a map pin or a list card — used to restore focus on close. */
  selectedVia: 'pin' | 'card' | null;
  /** Progressive-disclosure filter tray visibility. */
  trayOpen: boolean;
  /** Whether the full filtered city selection is currently revealed. */
  selectionOpen: boolean;
  guideYear: number;
  userLocation: UserLocation | null;
  geoStatus: string;
  geoBusy: boolean;
}

const state: State = {
  mode: 'loading',
  city: citySlugFromUrl(window.location.search),
  cities: [],
  venues: [],
  filter: '',
  sourceFilter: '',
  categoryFilter: '',
  selectedId: null,
  selectedVia: null,
  trayOpen: false,
  selectionOpen: false,
  guideYear: GUIDE_YEAR,
  userLocation: null,
  geoStatus: '',
  geoBusy: false,
};

/**
 * CSS selector of the element that should receive focus after the next
 * render. The whole root is re-rendered on every state change, so focus is
 * otherwise lost when a control is clicked.
 */
let pendingFocus: string | null = null;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ---------- helpers ---------- */

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function num(...candidates: unknown[]): number | null {
  for (const c of candidates) {
    const n = typeof c === 'string' ? parseFloat(c) : c;
    if (typeof n === 'number' && Number.isFinite(n)) return n;
  }
  return null;
}

function str(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return '';
}

/**
 * Extract the literal award-level label exactly as stored by the source
 * (e.g. '1 Sol', '3 Soles', '2 Stars'). Numbers are rendered as-is (e.g. '3').
 * Returns '' when no level is present — never guesses a wording.
 */
function parseAwardLevel(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
    if (typeof c === 'number' && Number.isFinite(c)) return String(c);
  }
  return '';
}

/** Numeric rank derived from a literal level label ('3 Soles' → 3); null when absent. */
function awardRankOf(level: string): number | null {
  const m = level.match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Ranked-list awards (e.g. '50 Top Pizza Europa 2026 — No. 2') carry an
// ordered position, not a star/sole count. Detect them by the source's own
// 'No. N' wording so level awards are never reinterpreted as rankings.
const LIST_RANK_RE = /\bNo\.\s*(\d+)\b/i;

/** List position parsed from a ranked-list level label; null for level awards. */
function listRankOf(level: string): number | null {
  const m = level.match(LIST_RANK_RE);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Edition/list name from a ranked-list label: the part before the '— No. N' suffix. */
function editionOf(level: string): string {
  return level.split(/\s*—\s*No\.\s*\d+/i)[0].trim() || level.trim();
}

/**
 * Icons matching the source's own wording only: suns for Soles, stars for
 * Michelin-style Stars. No icon when the wording is unknown.
 */
function awardIcons(a: Pick<VenueAward, 'awardLevel' | 'awardRank'>): string {
  if (a.awardRank === null) return '';
  if (/\bsol(es)?\b/i.test(a.awardLevel)) return '☀'.repeat(a.awardRank);
  if (/\bstars?\b/i.test(a.awardLevel)) return '★'.repeat(a.awardRank);
  return '';
}

/**
 * Awards sorted highest star/sole rank first, then ranked-list awards by best
 * (lowest) position, then by label and guide name for stability.
 */
function sortAwards(awards: VenueAward[]): VenueAward[] {
  return [...awards].sort(
    (a, b) =>
      (b.awardRank ?? -1) - (a.awardRank ?? -1) ||
      (a.listRank ?? Number.MAX_SAFE_INTEGER) - (b.listRank ?? Number.MAX_SAFE_INTEGER) ||
      a.awardLevel.localeCompare(b.awardLevel) ||
      a.sourceName.localeCompare(b.sourceName)
  );
}

/** The venue's highest-ranked recognition, when the live record has one. */
function topAward(v: Venue): VenueAward | null {
  return v.awards[0] ?? null;
}

/** Highest numeric rank across a venue's awards; -1 when none is parseable. */
function maxAwardRank(v: Venue): number {
  return v.awards.reduce((m, a) => Math.max(m, a.awardRank ?? -1), -1);
}

/** Best (lowest) ranked-list position across a venue's awards; MAX when none. */
function bestListRank(v: Venue): number {
  return v.awards.reduce(
    (m, a) => Math.min(m, a.listRank ?? Number.MAX_SAFE_INTEGER),
    Number.MAX_SAFE_INTEGER
  );
}

/* ---------- Detour community provenance (public only) ---------- */

/** The exact visible phrase used everywhere a community selection is shown. */
const COMMUNITY_LABEL = 'Detour community selection';

/** Whether the venue holds a current Detour community selection. */
function hasCommunityAward(v: Venue): boolean {
  return v.awards.some((a) => a.community);
}

/** Whether ALL of the venue's recognition is community provenance (no external guide). */
function onlyCommunityAwards(v: Venue): boolean {
  return v.awards.length > 0 && v.awards.every((a) => a.community);
}

/** Plain-text award label: 'No. N — edition' for ranked awards, else the literal level. */
function awardText(a: VenueAward): string {
  if (a.community) return COMMUNITY_LABEL;
  return a.listRank !== null ? `No. ${a.listRank} — ${a.edition}` : a.awardLevel;
}

/** Plain-text summary of live source badges and any retained recognition metadata. */
function awardSummary(v: Venue): string {
  const summary = v.awards.map((a) => {
    if (a.community) return COMMUNITY_LABEL;
    if (a.sourceBadge) return `Source badge: ${a.sourceName}`;
    return `${awardText(a)} — ${a.sourceName} ${a.awardYear}`;
  });
  return summary.join('; ') || [v.category, v.city].filter(Boolean).join(' in ');
}

/** Unique EXTERNAL guide names for retained recognition metadata. */
function guideNames(v: Venue): string[] {
  return [
    ...new Set(
      v.awards
        .filter((a) => !a.community && !a.sourceBadge)
        .map((a) => a.sourceName)
        .filter(Boolean)
    ),
  ];
}

/* ---------- live source badges ---------- */

function sourceBadgeClass(label: string): string {
  const normalized = label.trim().toLowerCase();
  if (normalized === 'michelin') return 'source-michelin';
  if (normalized === 'mof') return 'source-mof';
  return 'source-other';
}

/* ---------- city scoping ---------- */

function activeCity(): CityConfig | null {
  if (state.mode === 'loading') return cityBySlug(state.city);
  return availableCities().find((city) => city.slug === state.city) ?? null;
}

function venuesForCity(city: CityConfig): Venue[] {
  const name = city.name.toLowerCase();
  return state.venues.filter(
    (v) => v.citySlug === city.slug || (!v.citySlug && v.city.trim().toLowerCase() === name)
  );
}

/** Cities backed by both a live `cities` record and at least one joined live place. */
function availableCities(): CityConfig[] {
  if (state.mode !== 'live') return [];
  const liveBySlug = new Map(state.cities.map((city) => [city.slug, city]));
  return CITIES.flatMap((config) => {
    const live = liveBySlug.get(config.slug);
    if (!live) return [];
    const city: CityConfig = { ...config, name: live.name, country: live.country };
    return venuesForCity(city).length > 0 ? [city] : [];
  });
}

function cityIsAvailable(slug: CitySlug): boolean {
  return availableCities().some((city) => city.slug === slug);
}

/**
 * The active city's venues — the only venue list any filter, count, map, or
 * detail render may derive from, so records from another city can
 * never leak into the current view.
 */
function cityVenues(): Venue[] {
  const city = activeCity();
  return city ? venuesForCity(city) : [];
}

function resetCityState(): void {
  state.filter = '';
  state.sourceFilter = '';
  state.categoryFilter = '';
  state.selectedId = null;
  state.selectedVia = null;
  state.trayOpen = false;
  state.selectionOpen = false;
  state.userLocation = null;
  state.geoStatus = '';
  state.geoBusy = false;
  savedView = null;
  savedPinKey = '';
}

function cityHref(slug: CitySlug | null): string {
  const url = new URL(window.location.href);
  if (slug) url.searchParams.set('city', slug);
  else url.searchParams.delete('city');
  return `${url.pathname}${url.search}${url.hash}`;
}

function updateCityUrl(slug: CitySlug | null, mode: 'push' | 'replace'): void {
  const href = cityHref(slug);
  if (mode === 'push') window.history.pushState(null, '', href);
  else window.history.replaceState(null, '', href);
}

function switchCity(root: HTMLElement, slug: CitySlug): void {
  if (!cityIsAvailable(slug)) return;
  if (slug !== state.city) resetCityState();
  state.city = slug;
  updateCityUrl(slug, 'push');
  pendingFocus = '[data-city]';
  render(root);
}

function showCityChooser(root: HTMLElement): void {
  const previousCity = state.city;
  if (state.city !== null) resetCityState();
  state.city = null;
  updateCityUrl(null, 'push');
  pendingFocus = previousCity ? `[data-choose-city="${CSS.escape(previousCity)}"]` : null;
  render(root);
}

function applyRouteFromUrl(root: HTMLElement): void {
  const url = new URL(window.location.href);
  const requested = citySlugFromUrl(url.search);
  const hasCityParam = url.searchParams.has('city');
  const allowed =
    requested !== null && (state.mode === 'loading' || cityIsAvailable(requested));
  const nextCity = allowed ? requested : null;

  if (state.city !== nextCity) resetCityState();
  state.city = nextCity;

  // Invalid params, and valid deep links without published data, resolve to a
  // canonical chooser URL rather than silently selecting another city.
  if (hasCityParam && nextCity === null) updateCityUrl(null, 'replace');
  render(root);
}

/* ---------- filters ---------- */

/**
 * Award-level filter options derived from the loaded data's literal labels.
 * Ranked-list awards (per-venue 'No. N' labels) are excluded — they are
 * discovered through the category and guide controls instead.
 */
function awardFilters(): { value: Filter; label: string }[] {
  const seen = new Map<string, number | null>();
  for (const v of cityVenues()) {
    for (const a of v.awards) {
      if (a.listRank !== null || a.sourceBadge) continue;
      if (!seen.has(a.awardLevel)) seen.set(a.awardLevel, a.awardRank);
    }
  }
  const levels = [...seen.entries()].sort(
    (a, b) => (b[1] ?? -1) - (a[1] ?? -1) || a[0].localeCompare(b[0])
  );
  return [
    { value: '' as Filter, label: 'All' },
    ...levels.map(([level]) => ({ value: level as Filter, label: level })),
  ];
}

/** Stable category options present in the loaded data (e.g. 'Coffee', 'Pizza'). */
function categoryNames(): string[] {
  const names = new Set<string>();
  for (const v of cityVenues()) if (v.category) names.add(v.category);
  return [...names].sort((a, b) => a.localeCompare(b));
}

function sourceNames(): string[] {
  const names = new Set<string>();
  for (const v of cityVenues())
    for (const a of v.awards) if (a.sourceName) names.add(a.sourceName);
  return [...names].sort((a, b) => a.localeCompare(b));
}

function filteredVenues(): Venue[] {
  // A filter matches when ANY of the venue's awards matches, so a venue
  // recognised by several guides stays visible under each guide's filter.
  const list = cityVenues().filter(
    (v) =>
      (state.filter === '' || v.awards.some((a) => a.awardLevel === state.filter)) &&
      (state.sourceFilter === '' ||
        v.awards.some((a) => a.sourceName === state.sourceFilter)) &&
      (state.categoryFilter === '' || v.category === state.categoryFilter)
  );
  return [...list].sort(
    (a, b) =>
      maxAwardRank(b) - maxAwardRank(a) ||
      bestListRank(a) - bestListRank(b) ||
      (topAward(a)?.awardLevel ?? '').localeCompare(topAward(b)?.awardLevel ?? '') ||
      a.name.localeCompare(b.name)
  );
}

interface ActiveFilter {
  kind: 'award' | 'category' | 'source';
  label: string;
  value: string;
}

function activeFilters(): ActiveFilter[] {
  const chips: ActiveFilter[] = [];
  if (state.filter) chips.push({ kind: 'award', label: state.filter, value: state.filter });
  if (state.categoryFilter)
    chips.push({ kind: 'category', label: state.categoryFilter, value: state.categoryFilter });
  if (state.sourceFilter)
    chips.push({ kind: 'source', label: state.sourceFilter, value: state.sourceFilter });
  return chips;
}

/* ---------- interactive map (Leaflet + OpenStreetMap) ---------- */

type MappableVenue = Venue & { lat: number; lng: number };

function withinCity(city: CityConfig, p: UserLocation): boolean {
  const b = city.bounds;
  return p.lat > b.latMin && p.lat < b.latMax && p.lng > b.lngMin && p.lng < b.lngMax;
}

function mappableVenues(list: Venue[]): MappableVenue[] {
  return list.filter(
    (v): v is MappableVenue => v.lat !== null && v.lng !== null
  );
}

// The whole root is re-rendered on every state change, which destroys the
// map's DOM node. Keep a single module-level Leaflet instance and tear it
// down (removing all layers and listeners) before creating the next one so
// duplicate maps or leaked listeners can never occur.
let leafletMap: L.Map | null = null;
// Preserve the user's pan/zoom across re-renders. Cleared (so the map refits)
// whenever the set of visible pins changes, e.g. after filtering.
let savedView: { center: L.LatLng; zoom: number } | null = null;
let savedPinKey = '';

function destroyMap(): void {
  if (leafletMap) {
    leafletMap.remove();
    leafletMap = null;
  }
}

function mountMap(root: HTMLElement, list: Venue[]): void {
  destroyMap();
  const container = root.querySelector<HTMLElement>('#venue-map');
  if (!container) return;

  const city = activeCity();
  if (!city) return;
  const mappable = mappableVenues(list);
  // Include the active city in the key so a city switch always refits the map.
  const pinKey = `${city.slug}::${mappable.map((v) => v.id).join('|')}`;
  if (pinKey !== savedPinKey) {
    savedPinKey = pinKey;
    savedView = null;
  }

  const map = L.map(container, {
    center: city.center,
    zoom: city.zoom,
    scrollWheelZoom: false, // don't hijack page scroll
    zoomSnap: 0.5,
  });
  leafletMap = map;

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
  }).addTo(map);

  // Venue pins — only known venue positions are ever plotted.
  for (const v of mappable) {
    const selected = v.id === state.selectedId;
    const markerRank = maxAwardRank(v);
    // Community-only venues get their own rose pin; venues that also hold an
    // external guide award keep that award's pin so guide styling is preserved.
    const markerClass =
      markerRank > 0 ? `pin-${markerRank}` : onlyCommunityAwards(v) ? 'pin-community' : 'pin-ranked';
    const markerSignal = markerRank > 0 ? String(markerRank) : onlyCommunityAwards(v) ? 'D' : '#';
    const markerMeaning =
      markerRank > 0
        ? `${markerRank}-level guide recognition`
        : onlyCommunityAwards(v)
          ? 'Detour community selection'
          : 'ranked guide selection';
    const icon = L.divIcon({
      className: '',
      html: `<span class="map-pin ${markerClass}${selected ? ' pin-selected' : ''}" data-pin="${esc(v.id)}">
        <span class="pin-pivot" aria-hidden="true">
          <span class="pin-signal">${markerSignal}</span>
          <span class="pin-fold"></span>
        </span>
        <span class="pin-label">${esc(v.name)}<small>${esc(markerMeaning)}</small></span>
      </span>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
    const marker = L.marker([v.lat, v.lng], {
      icon,
      keyboard: false,
      riseOnHover: true,
      zIndexOffset: selected ? 1000 : Math.max(markerRank, 0) * 10,
    }).addTo(map);
    marker.bindPopup(
      `<strong>${esc(v.name)}</strong>${v.awards
        .map((a) =>
          a.community
            ? `<br><span class="popup-community"><span aria-hidden="true">❦</span> ${esc(COMMUNITY_LABEL)}</span>`
            : a.sourceBadge
              ? `<br>Source badge · ${esc(a.sourceName)}`
              : `<br>${awardIcons(a)} ${esc(awardText(a))} · ${esc(a.sourceName)} ${a.awardYear}`
        )
        .join('')}`,
      { closeButton: false, offset: [0, -6] }
    );
    const select = () => {
      const deselecting = state.selectedId === v.id;
      state.selectedId = deselecting ? null : v.id;
      state.selectedVia = deselecting ? null : 'pin';
      savedView = { center: map.getCenter(), zoom: map.getZoom() };
      pendingFocus = `[data-pin="${CSS.escape(v.id)}"]`;
      render(root);
    };
    const el = marker.getElement();
    if (el) {
      // The Leaflet marker root is zero-size (iconSize [0,0]); keep it out of
      // the tab order and make the inner .map-pin the real interactive target.
      el.setAttribute('tabindex', '-1');
      el.removeAttribute('role');
      el.removeAttribute('aria-label');
      const pin = el.querySelector<HTMLElement>('.map-pin');
      if (pin) {
        pin.setAttribute('role', 'button');
        pin.setAttribute('tabindex', '0');
        pin.setAttribute('aria-pressed', String(selected));
        pin.setAttribute(
          'aria-label',
          `${v.name}, ${awardSummary(v)}. ${selected ? 'Selected.' : 'Select for details.'}`
        );
        pin.addEventListener('click', (e) => {
          e.stopPropagation();
          select();
        });
        pin.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            select();
          }
        });
      }
    }
    if (selected) marker.openPopup();
  }

  // User location — shown only when the browser granted a real position that
  // plausibly falls inside the active city, so a distant visitor's marker
  // never appears on (or drags) another city's map.
  const userInCity =
    state.userLocation !== null && withinCity(city, state.userLocation);
  if (state.userLocation && userInCity) {
    L.circleMarker([state.userLocation.lat, state.userLocation.lng], {
      radius: 7,
      color: '#ffffff',
      weight: 3,
      fillColor: '#87c2a5',
      fillOpacity: 1,
    })
      .addTo(map)
      .bindTooltip('You are here');
  }

  // View: restore the user's last view, else fit the active city's real
  // pins, else stay on the city's fallback centre.
  if (savedView) {
    map.setView(savedView.center, savedView.zoom, { animate: false });
  } else if (mappable.length > 0) {
    const bounds = L.latLngBounds(
      mappable.map((v) => [v.lat, v.lng] as [number, number])
    );
    // Frame the user's marker only when it is inside the active city.
    const u = state.userLocation;
    if (u && userInCity) bounds.extend([u.lat, u.lng]);
    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 16 });
  }
  map.on('moveend zoomend', () => {
    savedView = { center: map.getCenter(), zoom: map.getZoom() };
  });
}

/* ---------- view fragments ---------- */

function mapNote(list: Venue[]): string {
  const mappable = mappableVenues(list);
  const refining = list.length - mappable.length;
  if (list.length === 0) {
    const city = activeCity();
    return city
      ? `Nothing matches at the moment — the map stays on ${city.name} while you adjust the filters.`
      : 'Nothing matches at the moment.';
  }
  if (mappable.length === 0)
    return 'Map positions for this selection are being refined. Every place remains available in the full selection.';
  if (refining > 0)
    return `${refining} ${refining === 1 ? 'place' : 'places'} in the full selection ${refining === 1 ? 'has its' : 'have their'} map position being refined.`;
  return '';
}

function mapStage(list: Venue[]): string {
  const note = mapNote(list);
  const cityName = esc(activeCity()?.name ?? 'Current city');
  return `<section class="map-stage" aria-label="${cityName} map">
    <div class="map-panel map-panel-live" role="group" aria-label="Interactive map of the ${cityName} selection">
      <div id="venue-map" class="venue-map" tabindex="-1" aria-label="${cityName} map"></div>
      ${note ? `<p class="map-note" role="status">${esc(note)}</p>` : ''}
    </div>
    ${detailPanel()}
  </section>`;
}

function listPreviewStage(): string {
  const cityName = esc(activeCity()?.name ?? 'Current city');
  return `<section class="list-preview" aria-labelledby="list-preview-title">
    <p class="list-preview-kicker">Editorial preview</p>
    <h2 id="list-preview-title">${cityName}, in the list first.</h2>
    <p>Every table below has a current award from a named guide. Map positions are still under editorial review, so this selection is presented as a list rather than a map.</p>
    ${detailPanel()}
  </section>`;
}

function refineChips(): string {
  const chips = activeFilters();
  if (chips.length === 0) return '';
  return `<div class="chips" aria-label="Active filters">
    ${chips
      .map(
        (c) => `<button type="button" class="chip" data-chip="${c.kind}"
          aria-label="Remove filter ${esc(c.label)}">${esc(c.label)}<span class="chip-x" aria-hidden="true">×</span></button>`
      )
      .join('')}
    <button type="button" class="chip chip-clear" data-clear-filters>Clear all</button>
  </div>`;
}

function filterTray(): string {
  if (!state.trayOpen) return '';
  const group = (
    id: string,
    label: string,
    buttons: string
  ) => `<div class="tray-group">
      <span class="tray-label" id="${id}">${label}</span>
      <div class="tray-options" role="group" aria-labelledby="${id}">${buttons}</div>
    </div>`;
  const awardButtons = awardFilters()
    .map(
      (f) => `<button type="button" class="filter${state.filter === f.value ? ' filter-active' : ''}"
        data-filter="${esc(f.value)}" aria-pressed="${state.filter === f.value}">${esc(f.label) || 'All'}</button>`
    )
    .join('');
  const categoryButtons =
    `<button type="button" class="filter${state.categoryFilter === '' ? ' filter-active' : ''}"
      data-category="" aria-pressed="${state.categoryFilter === ''}">All</button>` +
    categoryNames()
      .map(
        (name) => `<button type="button" class="filter${state.categoryFilter === name ? ' filter-active' : ''}"
          data-category="${esc(name)}" aria-pressed="${state.categoryFilter === name}">${esc(name)}</button>`
      )
      .join('');
  const sourceButtons =
    `<button type="button" class="filter${state.sourceFilter === '' ? ' filter-active' : ''}"
      data-source="" aria-pressed="${state.sourceFilter === ''}">All</button>` +
    sourceNames()
      .map(
        (name) => `<button type="button" class="filter${state.sourceFilter === name ? ' filter-active' : ''}"
          data-source="${esc(name)}" aria-pressed="${state.sourceFilter === name}">${esc(name)}</button>`
      )
      .join('');
  return `<div class="tray" id="filter-tray">
    ${group('tray-award', 'Recognition', awardButtons)}
    ${group('tray-category', 'Category', categoryButtons)}
    ${group('tray-source', 'Source', sourceButtons)}
    <div class="tray-actions">
      <button type="button" class="tray-clear" data-clear-filters>Clear filters</button>
      <button type="button" class="tray-done" data-tray-close>Done</button>
    </div>
  </div>`;
}

function citySelector(): string {
  return `<div class="city-control">
      <label class="visually-hidden" for="city-select">City</label>
      <select id="city-select" data-city>
        ${availableCities()
          .map(
            (city) =>
              `<option value="${esc(city.slug)}"${city.slug === state.city ? ' selected' : ''}>${esc(city.name)}, ${esc(city.country)}</option>`
          )
          .join('')}
      </select>
    </div>`;
}

function discoveryBar(city: CityConfig, list: Venue[]): string {
  const activeCount = activeFilters().length;
  return `<section class="discovery" aria-label="Explore the selection">
    <div class="discovery-row">
      <a class="all-cities-control" href="${esc(cityHref(null))}" data-all-cities>All cities</a>
      ${citySelector()}
      <button type="button" class="refine-btn${activeCount ? ' refine-btn-active' : ''}" data-tray-toggle
        aria-expanded="${state.trayOpen}" aria-controls="filter-tray">
        Refine${activeCount ? ` <span class="refine-count">${activeCount}</span>` : ''}
      </button>
      ${
        city.presentation === 'map'
          ? `<button type="button" class="nearby-btn" data-geolocate ${state.geoBusy ? 'disabled' : ''}>
              ${state.geoBusy ? 'Finding you…' : 'Show nearby'}
            </button>`
          : ''
      }
      <span class="count" aria-live="polite">${list.length} ${list.length === 1 ? 'place' : 'places'}</span>
    </div>
    ${filterTray()}
    ${refineChips()}
    ${state.geoStatus ? `<p class="geo-status" role="status">${esc(state.geoStatus)}</p>` : ''}
  </section>`;
}

function venueCard(v: Venue): string {
  const selected = v.id === state.selectedId;
  const rank = maxAwardRank(v);
  const cardTone =
    rank > 0 ? ` card-rank-${rank}` : onlyCommunityAwards(v) ? ' card-community' : ' card-ranked';
  return `<li>
    <article class="card${cardTone}${selected ? ' card-selected' : ''}">
      <button type="button" class="card-main" data-venue="${esc(v.id)}" aria-expanded="${selected}">
        <div class="card-top">
          <h3>${esc(v.name)}</h3>
          <span class="card-awards" role="list" aria-label="${esc(awardSummary(v))}">
            ${v.awards
              .map((a) =>
                a.community
                  ? `<span role="listitem" class="award award-community" title="${esc(COMMUNITY_LABEL)}">
                  <span aria-hidden="true">❦</span> ${esc(COMMUNITY_LABEL)}
                </span>`
                  : a.sourceBadge
                    ? `<span role="listitem" class="award award-source ${sourceBadgeClass(a.sourceName)}" title="Source badge: ${esc(a.sourceName)}">${esc(a.sourceName)}</span>`
                    : a.listRank !== null
                      ? `<span role="listitem" class="award award-ranked" title="${esc(awardText(a))} — ${esc(a.sourceName)} ${a.awardYear}">
                  <span class="award-rank-no">No. ${a.listRank}</span> ${esc(a.edition)}
                </span>`
                      : `<span role="listitem" class="award award-${a.awardRank ?? 0}" title="${esc(a.awardLevel)} — ${esc(a.sourceName)} ${a.awardYear}">
                  <span aria-hidden="true">${awardIcons(a)}</span> ${esc(a.awardLevel)}
                </span>`
              )
              .join('')}
          </span>
        </div>
        <p class="card-meta">${esc([v.category, v.neighborhood].filter(Boolean).join(' · '))}</p>
        <p class="card-address">${
          v.address
            ? esc(v.address)
            : '<span class="approx">Map position being refined</span>'
        }</p>
      </button>
      <div class="card-sources">
        ${v.awards
          .map((a) => {
            if (a.community)
              return `<p class="card-source card-source-community"><span aria-hidden="true">❦</span> ${esc(COMMUNITY_LABEL)} — Detour’s editorial selection</p>`;
            if (a.sourceBadge)
              return `<p class="card-source card-source-badge ${sourceBadgeClass(a.sourceName)}"><span>Source badge</span> · ${esc(a.sourceName)}</p>`;
            const claim =
              a.listRank !== null
                ? `No. ${a.listRank} · ${esc(a.edition)}`
                : `${esc(a.awardLevel)} · ${esc(a.sourceName)} ${a.awardYear}`;
            return `<p class="card-source">${claim}${
              a.sourceUrl
                ? ` — <a href="${esc(a.sourceUrl)}" target="_blank" rel="noopener noreferrer">Official guide ↗</a>`
                : ''
            }</p>`;
          })
          .join('')}
      </div>
    </article>
  </li>`;
}

function detailPanel(): string {
  const v = cityVenues().find((x) => x.id === state.selectedId);
  if (!v) {
    const prompt =
      activeCity()?.presentation === 'map'
        ? 'Choose a pin on the map — or open the full selection — to see more.'
        : 'Open the full selection and choose a place to see more.';
    return `<p class="map-prompt" aria-live="polite">${prompt}</p>`;
  }
  const guides = guideNames(v);
  const communityHere = hasCommunityAward(v);
  const sentences: string[] = [];
  if (guides.length > 0)
    sentences.push(`A current selection, independently recognised by ${guides.join(' and ')}.`);
  if (communityHere)
    sentences.push(
      guides.length > 0
        ? 'Also a Detour community selection, selected editorially by Detour.'
        : 'A Detour community selection, selected editorially by Detour.'
    );
  const guideSentence = sentences.join(' ');
  return `<aside class="detail" id="selected-place-detail" aria-live="polite" aria-label="Selected place">
    <div class="detail-head">
      <div>
        <p class="detail-overline">Selected place</p>
        <h2>${esc(v.name)}</h2>
        ${v.category || v.neighborhood ? `<p class="detail-meta">${esc([v.category, v.neighborhood].filter(Boolean).join(' · '))}</p>` : ''}
      </div>
      <button type="button" class="detail-close" data-close aria-label="Close details"><span aria-hidden="true">×</span></button>
    </div>
    <div class="detail-body">
      <section class="detail-recognition" aria-labelledby="detail-recognition-title">
        <h3 id="detail-recognition-title">Why it’s here</h3>
        ${
          v.awards.length
            ? `<ul class="detail-awards" aria-label="Source badges and recognition">
          ${v.awards
            .map((a) =>
              a.community
                ? `<li class="detail-award detail-award-community"><span aria-hidden="true">◆</span> ${esc(COMMUNITY_LABEL)}</li>`
                : a.sourceBadge
                  ? `<li class="detail-award detail-source-badge ${sourceBadgeClass(a.sourceName)}"><span>Source badge</span>${esc(a.sourceName)}</li>`
                  : a.listRank !== null
                    ? `<li class="detail-award detail-award-ranked"><span class="award-rank-no">No. ${a.listRank}</span> ${esc(
                        a.edition
                      )} · ${esc(a.sourceName)}</li>`
                    : `<li class="detail-award award-${a.awardRank ?? 0}"><span aria-hidden="true">${awardIcons(a)}</span> ${esc(
                        a.awardLevel
                      )} · ${esc(a.sourceName)} ${a.awardYear}</li>`
            )
            .join('')}
        </ul>`
            : ''
        }
        ${v.description ? `<p class="detail-description">${esc(v.description)}</p>` : ''}
        ${guideSentence ? `<p class="detail-note">${esc(guideSentence)}</p>` : ''}
      </section>
      <section class="detail-practical" aria-labelledby="detail-practical-title">
        <h3 id="detail-practical-title">Place details</h3>
        <dl class="detail-facts">
          <div><dt>Address</dt><dd>${
            v.address
              ? esc(v.address)
              : '<span class="approx">Map position being refined</span>'
          }</dd></div>
          ${(() => {
            // Only retained external-guide recognition belongs under “Official guide”.
            const external = v.awards.filter((a) => !a.community && !a.sourceBadge);
            const guideRow = external.length
              ? `<div><dt>Official guide${external.length === 1 ? '' : 's'}</dt><dd>${external
                  .map((a) =>
                    a.sourceUrl
                      ? `<a href="${esc(a.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(a.sourceName)} ${a.awardYear} ↗</a>`
                      : `${esc(a.sourceName)} ${a.awardYear}`
                  )
                  .join('<br>')}</dd></div>`
              : '';
            const communityRow = communityHere
              ? `<div><dt>Community</dt><dd>${esc(COMMUNITY_LABEL)} — Detour’s editorial selection</dd></div>`
              : '';
            return guideRow + communityRow;
          })()}
        </dl>
      </section>
    </div>
  </aside>`;
}

/* ---------- render ---------- */

/** Keep the browser tab title and description in step with the current route. */
function syncDocumentMeta(city: CityConfig | null): void {
  document.title = city?.metaTitle ?? GLOBAL_META_TITLE;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (meta) meta.setAttribute('content', city?.metaDescription ?? GLOBAL_META_DESCRIPTION);
}

function cityTagline(city: CityConfig): string {
  return city.tagline.replace('{count}', String(venuesForCity(city).length));
}

function bindRouteLinks(root: HTMLElement): void {
  root.querySelectorAll<HTMLAnchorElement>('[data-choose-city]').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const city = cityBySlug(link.dataset.chooseCity);
      if (!city || !cityIsAvailable(city.slug)) return;
      event.preventDefault();
      switchCity(root, city.slug);
    });
  });
  root.querySelector<HTMLAnchorElement>('[data-all-cities]')?.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    showCityChooser(root);
  });
}

function renderCityChooser(root: HTMLElement): void {
  destroyMap();
  syncDocumentMeta(null);
  const cities = availableCities();
  const status =
    state.mode === 'loading'
      ? '<p class="city-chooser-status loading" role="status">Checking the current published selections…</p>'
      : state.mode === 'error'
        ? '<p class="city-chooser-status status-banner" role="status">The current city selections could not be loaded. Please try again shortly.</p>'
        : cities.length === 0
          ? '<p class="city-chooser-status" role="status">No city selections are published at the moment. Please return soon.</p>'
          : '';
  const choices =
    state.mode !== 'live'
      ? ''
      : `<ul class="city-choices" id="city-choices" aria-label="Published city selections">
          ${cities
            .map((city) => {
              const count = venuesForCity(city).length;
              return `<li class="city-choice city-choice-${esc(city.slug)}">
                <article class="city-choice-content">
                  <span class="city-choice-swatch" aria-hidden="true"><span></span></span>
                  <p class="city-choice-place"><span class="city-choice-name">${esc(city.name)}</span><span class="city-choice-separator">, </span><span class="city-choice-country">${esc(city.country)}</span></p>
                  <p class="city-choice-count">${count} current ${count === 1 ? 'selection' : 'selections'}</p>
                  <a class="city-choice-action" href="${esc(cityHref(city.slug))}" data-choose-city="${esc(city.slug)}">Explore ${esc(city.name)}<span aria-hidden="true">↗</span></a>
                </article>
              </li>`;
            })
            .join('')}
        </ul>`;

  root.innerHTML = `
    <a class="skip-link" href="#city-chooser-title">Skip to city choices</a>
    <header class="hero city-chooser-hero">
      <div class="hero-inner city-chooser-header">
        <p class="brand">Detour</p>
        <h1>Trust the experts. Great food is never a straight line.</h1>
        <p class="tagline city-chooser-intro">Detour is a collection of exceptional tables across cities, chosen for the recognition they hold now. Choose a city to explore its current selection.</p>
        <div class="hero-account">${communityControl()}</div>
      </div>
    </header>
    ${communityPanel(state.venues)}
    <section class="city-chooser" aria-labelledby="city-chooser-title">
      <div class="city-chooser-heading">
        <h2 id="city-chooser-title">Choose a city</h2>
        <p>Begin with the place you want to know through its most distinguished tables.</p>
      </div>
      ${status}
      ${choices}
    </section>
    <footer class="footer city-chooser-footer">
      <p>Independent guides keep their own voice and attribution. Detour brings their current selections together in one deliberately edited collection.</p>
    </footer>
  `;

  bindCommunity(root, state.venues, () => render(root));
  bindRouteLinks(root);
  if (pendingFocus) {
    const target = root.querySelector<HTMLElement>(pendingFocus);
    pendingFocus = null;
    target?.focus({ preventScroll: true });
  }
}

function render(root: HTMLElement) {
  const city = activeCity();
  if (state.mode === 'loading' || !city || !cityIsAvailable(city.slug)) {
    renderCityChooser(root);
    return;
  }

  syncDocumentMeta(city);
  const list = filteredVenues();
  const emptyState = `<div class="empty-state" role="status">
      <p class="empty-state-title">Nothing matches yet</p>
      <p class="empty-state-body">Adjust the filters, or start again with the full ${esc(city.name)} selection.</p>
      <button type="button" class="empty-state-reset" data-reset-filters>Show everything</button>
    </div>`;
  const selectionLabel = `${list.length} ${list.length === 1 ? 'place' : 'places'}`;

  root.innerHTML = `
    <a class="skip-link" href="${city.presentation === 'map' ? '#venue-map' : '#selection-disclosure-title'}">Skip to city discovery</a>
    <header class="hero city-detail-hero">
      <div class="hero-inner">
        <p class="brand">Detour</p>
        <h1>${esc(city.title)}</h1>
        <p class="tagline">${esc(cityTagline(city))}</p>
        <div class="hero-account">${communityControl()}</div>
      </div>
    </header>
    ${communityPanel(state.venues)}
    ${discoveryBar(city, list)}
    ${city.presentation === 'map' ? mapStage(list) : listPreviewStage()}
    <section class="selection-disclosure" aria-labelledby="selection-disclosure-title">
      <div class="selection-disclosure-copy">
        <h2 id="selection-disclosure-title">Full selection</h2>
        <p>${selectionLabel} ${list.length === 1 ? 'matches' : 'match'} the current filters. Open the list when you want to browse every place.</p>
      </div>
      <button type="button" class="selection-toggle" data-selection-toggle
        aria-expanded="${state.selectionOpen}" aria-controls="selection-results">
        ${state.selectionOpen ? 'Hide' : 'Show'} full selection <span>${list.length}</span>
      </button>
      <div class="results" id="selection-results"${state.selectionOpen ? '' : ' hidden'}>
        ${state.selectionOpen ? (list.length ? `<ul class="card-list">${list.map(venueCard).join('')}</ul>` : emptyState) : ''}
      </div>
    </section>
    <footer class="footer">
      <p>${esc(city.footer)}</p>
    </footer>
  `;

  bindCommunity(root, state.venues, () => render(root));
  bindRouteLinks(root);

  const keepSelectionValid = () => {
    const visible = filteredVenues();
    if (state.selectedId && !visible.some((v) => v.id === state.selectedId)) {
      state.selectedId = null;
      state.selectedVia = null;
    }
  };

  root.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filter = btn.dataset.filter ?? '';
      keepSelectionValid();
      pendingFocus = `[data-filter="${CSS.escape(btn.dataset.filter ?? '')}"]`;
      render(root);
    });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-category]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.categoryFilter = btn.dataset.category ?? '';
      keepSelectionValid();
      pendingFocus = `[data-category="${CSS.escape(btn.dataset.category ?? '')}"]`;
      render(root);
    });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-source]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.sourceFilter = btn.dataset.source ?? '';
      keepSelectionValid();
      pendingFocus = `[data-source="${CSS.escape(btn.dataset.source ?? '')}"]`;
      render(root);
    });
  });
  root.querySelector<HTMLButtonElement>('[data-tray-toggle]')?.addEventListener('click', () => {
    state.trayOpen = !state.trayOpen;
    pendingFocus = '[data-tray-toggle]';
    render(root);
  });
  root.querySelector<HTMLButtonElement>('[data-tray-close]')?.addEventListener('click', () => {
    state.trayOpen = false;
    pendingFocus = '[data-tray-toggle]';
    render(root);
  });
  root.querySelector<HTMLButtonElement>('[data-selection-toggle]')?.addEventListener('click', () => {
    state.selectionOpen = !state.selectionOpen;
    if (!state.selectionOpen && state.selectedVia === 'card') state.selectedVia = null;
    pendingFocus = '[data-selection-toggle]';
    render(root);
  });
  root.querySelectorAll<HTMLButtonElement>('[data-chip]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.chip;
      if (kind === 'award') state.filter = '';
      if (kind === 'category') state.categoryFilter = '';
      if (kind === 'source') state.sourceFilter = '';
      keepSelectionValid();
      pendingFocus = '[data-tray-toggle]';
      render(root);
    });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-clear-filters]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filter = '';
      state.sourceFilter = '';
      state.categoryFilter = '';
      pendingFocus = '[data-tray-toggle]';
      render(root);
    });
  });
  root.querySelector<HTMLButtonElement>('[data-geolocate]')?.addEventListener('click', () => {
    requestUserLocation(root);
  });
  const citySelect = root.querySelector<HTMLSelectElement>('[data-city]');
  citySelect?.addEventListener('change', () => {
    const next = cityBySlug(citySelect.value);
    if (next) switchCity(root, next.slug);
  });
  root.querySelectorAll<HTMLButtonElement>('[data-venue]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.venue ?? null;
      const deselecting = state.selectedId === id;
      state.selectedId = deselecting ? null : id;
      state.selectedVia = deselecting ? null : 'card';
      pendingFocus = id ? `[data-venue="${CSS.escape(id)}"]` : null;
      render(root);
      if (!deselecting) {
        root.querySelector('.detail')?.scrollIntoView({
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          block: 'nearest',
        });
      }
    });
  });
  root.querySelector<HTMLButtonElement>('[data-reset-filters]')?.addEventListener('click', () => {
    state.filter = '';
    state.sourceFilter = '';
    state.categoryFilter = '';
    pendingFocus = '[data-selection-toggle]';
    render(root);
  });
  root.querySelector('[data-close]')?.addEventListener('click', () => {
    const closedId = state.selectedId;
    const via = state.selectedVia;
    state.selectedId = null;
    state.selectedVia = null;
    // Return focus to the card or pin that opened the detail.
    pendingFocus =
      closedId === null
        ? null
        : via === 'pin'
          ? `[data-pin="${CSS.escape(closedId)}"]`
          : via === 'card'
            ? `[data-venue="${CSS.escape(closedId)}"]`
            : '[data-selection-toggle]';
    render(root);
  });

  // (Re)create the Leaflet map only for cities published as map experiences.
  if (city.presentation === 'map') mountMap(root, list);
  else destroyMap();

  // Restore focus to the control that triggered this render (map pins are
  // only queryable after mountMap).
  if (pendingFocus) {
    const target = root.querySelector<HTMLElement>(pendingFocus);
    pendingFocus = null;
    target?.focus({ preventScroll: true });
  }
}

/* ---------- geolocation (opt-in only) ---------- */

function geoFallback(): string {
  const city = activeCity();
  return city
    ? `We couldn’t find your position, so the map stays on ${city.name} — everything else works as usual.`
    : 'We couldn’t find your position. Choose a city and try again.';
}

function requestUserLocation(root: HTMLElement): void {
  if (state.geoBusy) return;
  if (!('geolocation' in navigator)) {
    state.userLocation = null;
    state.geoStatus = geoFallback();
    render(root);
    return;
  }
  state.geoBusy = true;
  state.geoStatus = 'Finding places near you…';
  pendingFocus = '[data-geolocate]';
  render(root);
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.geoBusy = false;
      const { latitude, longitude } = pos.coords;
      // Treat 0/0 (and non-finite values) as unknown — never plot them.
      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        (latitude === 0 && longitude === 0)
      ) {
        state.userLocation = null;
        state.geoStatus = geoFallback();
      } else {
        const city = activeCity();
        if (!city) {
          state.userLocation = null;
          state.geoStatus = '';
        } else {
          state.userLocation = { lat: latitude, lng: longitude };
          if (withinCity(city, state.userLocation)) {
            state.geoStatus = 'You’re on the map — look for the mint location dot.';
          } else {
            state.geoStatus = `You seem to be outside ${city.name}, so the map stays on the city — everything else works as usual.`;
          }
          savedView = null; // refit / recenter so the user sees their marker context
        }
      }
      pendingFocus = '[data-geolocate]';
      render(root);
    },
    () => {
      state.geoBusy = false;
      state.userLocation = null;
      state.geoStatus = geoFallback();
      pendingFocus = '[data-geolocate]';
      render(root);
    },
    { timeout: 10000, maximumAge: 60000 }
  );
}

/* ---------- boot ---------- */

const root = document.querySelector('#app');
if (root instanceof HTMLElement) {
  applyRouteFromUrl(root);
  window.addEventListener('popstate', () => applyRouteFromUrl(root));
  loadLiveCatalogue()
    .then(({ cities, venues }) => {
      state.mode = 'live';
      state.cities = cities;
      state.venues = venues;
      state.guideYear =
        venues.reduce(
          (year, venue) =>
            venue.awards.reduce((current, award) => Math.max(current, award.awardYear), year),
          0
        ) || GUIDE_YEAR;
      applyRouteFromUrl(root);
    })
    .catch(() => {
      state.mode = 'error';
      state.cities = [];
      state.venues = [];
      applyRouteFromUrl(root);
    });
}
