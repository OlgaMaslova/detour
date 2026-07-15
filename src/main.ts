import './styles.css';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { pb } from './pocketbase';
import { demoVenues, GUIDE_YEAR } from './data';
import type { Venue, VenueAward } from './data';
import { CITIES, cityBySlug, citySlugFromUrl } from './cities';
import type { CityConfig, CitySlug } from './cities';
import { bindCommunity, communityControl, communityPanel } from './community';

/** '' = all award levels; otherwise a literal level label present in the loaded data. */
type Filter = string;
type DataMode = 'loading' | 'live' | 'demo';

interface UserLocation {
  lat: number;
  lng: number;
}

interface State {
  mode: DataMode;
  /** Active city; every filter/search/count/map/detail render is scoped to it. */
  city: CitySlug;
  /** Every loaded venue, across all cities. Never rendered directly — see cityVenues(). */
  venues: Venue[];
  filter: Filter;
  /** '' = all sources; otherwise a source name present in the loaded data. */
  sourceFilter: string;
  /** '' = all categories; otherwise a venue category present in the loaded data (e.g. 'Pizza', 'Coffee'). */
  categoryFilter: string;
  /** Free-text venue-name search; matched case-insensitively after trimming. */
  search: string;
  selectedId: string | null;
  /** Whether the last selection came from a map pin or a list card — used to restore focus on close. */
  selectedVia: 'pin' | 'card' | null;
  /** Progressive-disclosure filter tray visibility. */
  trayOpen: boolean;
  guideYear: number;
  userLocation: UserLocation | null;
  geoStatus: string;
  geoBusy: boolean;
}

const state: State = {
  mode: 'loading',
  city: citySlugFromUrl(window.location.search),
  venues: [],
  filter: '',
  sourceFilter: '',
  categoryFilter: '',
  search: '',
  selectedId: null,
  selectedVia: null,
  trayOpen: false,
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

/** The venue's highest-ranked award (awards lists are never empty). */
function topAward(v: Venue): VenueAward {
  return v.awards[0];
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

// The community's own selections live in the same public venue_awards /
// guide_sources collections as external guides, published under this one
// dedicated source. Detection uses only those public fields — never
// detour_submissions, members, notes, or any other private collection.
const COMMUNITY_SOURCE_SLUG = 'detour-community';
const COMMUNITY_SOURCE_NAME = 'detour community';
const COMMUNITY_LEVEL = 'detour community selection';
/** The exact visible phrase used everywhere a community selection is shown. */
const COMMUNITY_LABEL = 'Detour community selection';

/** True when a live award's public source/level marks it as the community's own selection. */
function isCommunityProvenance(level: string, sourceSlug: string, sourceName: string): boolean {
  return (
    sourceSlug.toLowerCase() === COMMUNITY_SOURCE_SLUG ||
    sourceName.trim().toLowerCase() === COMMUNITY_SOURCE_NAME ||
    level.trim().toLowerCase() === COMMUNITY_LEVEL
  );
}

/** Whether the venue holds a current Detour community selection. */
function hasCommunityAward(v: Venue): boolean {
  return v.awards.some((a) => a.community);
}

/** Whether ALL of the venue's recognition is community provenance (no external guide). */
function onlyCommunityAwards(v: Venue): boolean {
  return v.awards.every((a) => a.community);
}

/** Plain-text award label: 'No. N — edition' for ranked awards, else the literal level. */
function awardText(a: VenueAward): string {
  if (a.community) return COMMUNITY_LABEL;
  return a.listRank !== null ? `No. ${a.listRank} — ${a.edition}` : a.awardLevel;
}

/** Plain-text summary of every award, keeping each guide's own wording. */
function awardSummary(v: Venue): string {
  return v.awards
    .map((a) => (a.community ? COMMUNITY_LABEL : `${awardText(a)} — ${a.sourceName} ${a.awardYear}`))
    .join('; ');
}

/** Unique EXTERNAL guide names for a venue, in award order. The Detour community is not a guide. */
function guideNames(v: Venue): string[] {
  return [...new Set(v.awards.filter((a) => !a.community).map((a) => a.sourceName).filter(Boolean))];
}

/* ---------- live data loading ---------- */

type Rec = Record<string, unknown>;

async function loadLiveVenues(): Promise<Venue[]> {
  const [venueRecs, awardRecs, sourceRecs] = await Promise.all([
    pb.collection('venues').getFullList<Rec>({ requestKey: null }),
    pb
      .collection('venue_awards')
      .getFullList<Rec>({ requestKey: null })
      .catch(() => [] as Rec[]),
    pb
      .collection('guide_sources')
      .getFullList<Rec>({ requestKey: null })
      .catch(() => [] as Rec[]),
  ]);

  const sourceById = new Map<string, Rec>();
  for (const s of sourceRecs) sourceById.set(String(s.id), s);

  const venueById = new Map<string, Rec>();
  for (const venue of venueRecs) venueById.set(String(venue.id), venue);

  // A venue can be recognised by several independent sources. Render one card
  // per canonical venue, collecting every current award into its awards list so
  // a Michelin Star can never inherit a Repsol Sol label (or vice versa) and a
  // multi-guide venue never appears twice.
  const venuesById = new Map<string, Venue>();
  for (const award of awardRecs) {
    if (award.current === false) continue;
    const year = num(award.year, award.guide_year);
    if (year !== null && year !== GUIDE_YEAR) continue;

    const venueId = str(award.venue as string, award.venue_id as string);
    const venue = venueById.get(venueId);
    if (!venue) continue;

    // Award levels are stored as literal strings like '1 Sol' / '3 Soles'
    // (Guía Repsol) or '1 Star' / '3 Stars' (Michelin Guide); keep the
    // source's exact wording.
    const level = parseAwardLevel(
      award.level,
      award.soles,
      venue.award_level,
      venue.soles,
      venue.award
    );
    if (!level) continue;

    // The backend stores an explicit numeric rank for ranked-list awards
    // (venue_awards.rank, e.g. 2 for '… — No. 2'); prefer it over parsing.
    const explicitRank = num(award.rank);
    const parsedListRank = listRankOf(level);
    const isRankedList = parsedListRank !== null;
    // Legacy Stars/Soles rows use 0 as the unset-rank sentinel. Only a
    // positive explicit rank is meaningful; otherwise preserve the literal
    // level's star/sole count.
    const positiveExplicitRank =
      explicitRank !== null && explicitRank > 0 ? explicitRank : null;

    const sourceId = str(
      award.source as string,
      award.guide_source as string,
      venue.source as string,
      venue.guide_source as string
    );
    const source = sourceId ? sourceById.get(sourceId) : undefined;

    const sourceSlug = str(source?.slug as string);
    const resolvedSourceName =
      str(
        source?.name as string,
        source?.title as string,
        award.source_name as string,
        venue.source_name as string
      ) || (source ? 'Unknown guide' : 'Unknown source');
    // Public community provenance: the community's own selection, published
    // under the dedicated 'detour-community' guide source. Never a star/sole
    // level, never a ranked list, never linked as an external guide.
    const community = isCommunityProvenance(level, sourceSlug, resolvedSourceName);

    // Detailed verification notes are private editorial provenance. The
    // backend exposes only this narrowly scoped public location qualifier.
    const approxLocation = Boolean(venue.approx_location ?? venue.location_approximate);

    // The backend stores 0/0 as a neutral "no known coordinates" sentinel
    // (see the seed migrations). Treat it — and missing values — as unknown
    // location rather than plotting a fake pin.
    const rawLat = num(venue.lat, venue.latitude);
    const rawLng = num(venue.lng, venue.lon, venue.longitude);
    const hasCoords =
      rawLat !== null && rawLng !== null && !(rawLat === 0 && rawLng === 0);
    const lat = hasCoords ? rawLat : null;
    const lng = hasCoords ? rawLng : null;

    const venueAward: VenueAward = {
      awardLevel: community ? COMMUNITY_LABEL : level,
      // A ranked-list position is never a star/sole count — keep the two
      // notions strictly separate so icons/ordering stay faithful. Community
      // selections carry neither: they are not graded or ranked.
      awardRank: community ? null : isRankedList ? null : (positiveExplicitRank ?? awardRankOf(level)),
      listRank: community ? null : isRankedList ? (positiveExplicitRank ?? parsedListRank) : null,
      edition: community || !isRankedList ? '' : editionOf(level),
      awardYear: year ?? GUIDE_YEAR,
      sourceName: community ? 'Detour community' : resolvedSourceName,
      // Community selections are Detour's own — never linked as an external guide.
      sourceUrl: community
        ? ''
        : str(
            award.source_url as string,
            source?.official_url as string,
            source?.url as string,
            source?.website as string,
            venue.source_url as string,
            venue.website as string
          ),
      note: '',
      community,
    };

    const existing = venuesById.get(venueId);
    if (existing) {
      existing.awards.push(venueAward);
      existing.approxLocation = existing.approxLocation || approxLocation;
      continue;
    }

    venuesById.set(venueId, {
      id: venueId,
      name: str(venue.name, venue.title) || 'Unnamed venue',
      city: str(venue.city, venue.town, venue.locality),
      awards: [venueAward],
      category: str(venue.category, venue.cuisine, venue.style),
      neighborhood: str(venue.neighborhood, venue.district, venue.area),
      address: str(venue.address, venue.street_address),
      lat,
      lng,
      approxLocation,
    });
  }
  const venues = [...venuesById.values()];
  for (const v of venues) v.awards = sortAwards(v.awards);
  return venues;
}

/* ---------- city scoping ---------- */

function activeCity(): CityConfig {
  return cityBySlug(state.city) ?? CITIES[0];
}

/**
 * The active city's venues — the only venue list any filter, search, count,
 * map, or detail render may derive from, so records from another city can
 * never leak into the current view.
 */
function cityVenues(): Venue[] {
  const name = activeCity().name.toLowerCase();
  return state.venues.filter((v) => v.city.trim().toLowerCase() === name);
}

function switchCity(root: HTMLElement, slug: CitySlug): void {
  if (slug === state.city) return;
  state.city = slug;
  // A city switch starts a fresh exploration: clear every scoped control.
  state.filter = '';
  state.sourceFilter = '';
  state.categoryFilter = '';
  state.search = '';
  state.selectedId = null;
  state.selectedVia = null;
  state.trayOpen = false;
  state.userLocation = null;
  state.geoStatus = '';
  savedView = null;
  savedPinKey = '';
  const url = new URL(window.location.href);
  url.searchParams.set('city', slug);
  window.history.replaceState(null, '', url);
  pendingFocus = '[data-city]';
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
      if (a.listRank !== null) continue;
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
  const query = state.search.trim().toLowerCase();
  // A filter matches when ANY of the venue's awards matches, so a venue
  // recognised by several guides stays visible under each guide's filter.
  const list = cityVenues().filter(
    (v) =>
      (state.filter === '' || v.awards.some((a) => a.awardLevel === state.filter)) &&
      (state.sourceFilter === '' ||
        v.awards.some((a) => a.sourceName === state.sourceFilter)) &&
      (state.categoryFilter === '' || v.category === state.categoryFilter) &&
      (query === '' || v.name.toLowerCase().includes(query))
  );
  return [...list].sort(
    (a, b) =>
      maxAwardRank(b) - maxAwardRank(a) ||
      bestListRank(a) - bestListRank(b) ||
      topAward(a).awardLevel.localeCompare(topAward(b).awardLevel) ||
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
    const icon = L.divIcon({
      className: '',
      html: `<span class="map-pin ${markerClass}${selected ? ' pin-selected' : ''}" data-pin="${esc(v.id)}">
        <span class="pin-dot"></span>
        <span class="pin-label">${esc(v.name)}</span>
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
        pin.setAttribute('aria-label', `${v.name}, ${awardSummary(v)}`);
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
      color: '#f6f0e4',
      weight: 2,
      fillColor: '#c78f97',
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
    return cityVenues().length === 0
      ? `The ${city.name} selection isn’t published here yet — the map stays on ${city.name}.`
      : `Nothing matches at the moment — the map stays on ${city.name} while you adjust your search.`;
  }
  if (mappable.length === 0)
    return 'Map positions for this selection are being refined. Every place is still listed below.';
  if (refining > 0)
    return `${refining} ${refining === 1 ? 'place' : 'places'} in the list ${refining === 1 ? 'has its' : 'have their'} map position being refined.`;
  return '';
}

function mapStage(list: Venue[]): string {
  const note = mapNote(list);
  const cityName = esc(activeCity().name);
  return `<section class="map-stage" aria-label="${cityName} map">
    <div class="map-panel map-panel-live" role="group" aria-label="Interactive map of the ${cityName} selection">
      <div id="venue-map" class="venue-map" tabindex="-1" aria-label="${cityName} map"></div>
      ${note ? `<p class="map-note" role="status">${esc(note)}</p>` : ''}
    </div>
    ${detailPanel()}
  </section>`;
}

function listPreviewStage(): string {
  const cityName = esc(activeCity().name);
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
        ${CITIES.map(
          (c) =>
            `<option value="${esc(c.slug)}"${c.slug === state.city ? ' selected' : ''}>${esc(c.name)}, ${esc(c.country)}${c.presentation === 'list' ? ' — list preview' : ''}</option>`
        ).join('')}
      </select>
    </div>`;
}

function discoveryBar(list: Venue[], loading: boolean): string {
  const activeCount = activeFilters().length;
  return `<section class="discovery" aria-label="Explore the selection">
    <div class="discovery-row">
      ${citySelector()}
      <div class="search-control">
        <label class="visually-hidden" for="venue-search">Search by name</label>
        <input type="search" id="venue-search" data-search
          value="${esc(state.search)}"
          placeholder="${esc(activeCity().searchPlaceholder)}"
          autocomplete="off" spellcheck="false" />
      </div>
      <button type="button" class="refine-btn${activeCount ? ' refine-btn-active' : ''}" data-tray-toggle
        aria-expanded="${state.trayOpen}" aria-controls="filter-tray">
        Refine${activeCount ? ` <span class="refine-count">${activeCount}</span>` : ''}
      </button>
      ${
        activeCity().presentation === 'map'
          ? `<button type="button" class="nearby-btn" data-geolocate ${state.geoBusy ? 'disabled' : ''}>
              ${state.geoBusy ? 'Finding you…' : 'Show nearby'}
            </button>`
          : ''
      }
      <span class="count" aria-live="polite">${
        loading ? 'Preparing the selection…' : `${list.length} ${list.length === 1 ? 'place' : 'places'}`
      }</span>
    </div>
    ${filterTray()}
    ${refineChips()}
    ${state.geoStatus ? `<p class="geo-status" role="status">${esc(state.geoStatus)}</p>` : ''}
  </section>`;
}

function venueCard(v: Venue): string {
  const selected = v.id === state.selectedId;
  return `<li>
    <article class="card${selected ? ' card-selected' : ''}">
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
      activeCity().presentation === 'map'
        ? 'Choose a pin on the map — or a place in the list — to see more.'
        : 'Choose a place in the list to see more.';
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
  return `<aside class="detail" aria-live="polite" aria-label="Selected place">
    <div class="detail-head">
      <div>
        <h2>${esc(v.name)}</h2>
        ${v.category || v.neighborhood ? `<p class="detail-meta">${esc([v.category, v.neighborhood].filter(Boolean).join(' · '))}</p>` : ''}
      </div>
      <button type="button" class="detail-close" data-close aria-label="Close details">✕</button>
    </div>
    <ul class="detail-awards" aria-label="Recognition">
      ${v.awards
        .map((a) =>
          a.community
            ? `<li class="detail-award detail-award-community"><span aria-hidden="true">❦</span> ${esc(COMMUNITY_LABEL)}</li>`
            : a.listRank !== null
              ? `<li class="detail-award detail-award-ranked"><span class="award-rank-no">No. ${a.listRank}</span> ${esc(
                  a.edition
                )} · ${esc(a.sourceName)}</li>`
              : `<li class="detail-award award-${a.awardRank ?? 0}"><span aria-hidden="true">${awardIcons(a)}</span> ${esc(
                  a.awardLevel
                )} · ${esc(a.sourceName)} ${a.awardYear}</li>`
        )
        .join('')}
    </ul>
    ${guideSentence ? `<p class="detail-note">${esc(guideSentence)}</p>` : ''}
    <dl class="detail-facts">
      <div><dt>Address</dt><dd>${
        v.address
          ? esc(v.address)
          : '<span class="approx">Map position being refined</span>'
      }</dd></div>
      ${(() => {
        // Only external guide awards belong under “Official guide” — the
        // Detour community is never presented or linked as one.
        const external = v.awards.filter((a) => !a.community);
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
  </aside>`;
}

/* ---------- render ---------- */

/**
 * Keep the browser tab title and the meta description in step with the
 * active city. The static index.html defaults cover the pre-JS load; from
 * the first render onwards the document reflects the city being explored.
 */
function syncDocumentMeta(city: CityConfig): void {
  document.title = city.metaTitle;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (meta) meta.setAttribute('content', city.metaDescription);
}

function render(root: HTMLElement) {
  const city = activeCity();
  syncDocumentMeta(city);
  const list = filteredVenues();
  const cityHasVenues = cityVenues().length > 0;
  const previewBanner =
    state.mode === 'demo' && cityHasVenues
      ? `<p class="status-banner" role="status">You’re seeing a limited preview of the ${esc(city.name)} selection. The full, current list will be back shortly.</p>`
      : '';
  const loading = state.mode === 'loading';
  const emptyState = cityHasVenues
    ? `<div class="empty-state" role="status">
        <p class="empty-state-title">Nothing matches yet</p>
        <p class="empty-state-body">Try a different name, or start again with the full ${esc(city.name)} selection.</p>
        <button type="button" class="empty-state-reset" data-reset-filters>Show everything</button>
      </div>`
    : `<div class="empty-state" role="status">
        <p class="empty-state-title">Nothing to show for ${esc(city.name)} yet</p>
        <p class="empty-state-body">${esc(city.unavailableCopy)}</p>
      </div>`;

  root.innerHTML = `
    <a class="skip-link" href="#selection-results">Skip to the selection</a>
    <header class="hero">
      <div class="hero-inner">
        <p class="brand">Detour</p>
        <h1>${esc(city.title)}</h1>
        <p class="tagline">${esc(city.tagline)}</p>
        <div class="hero-account">${communityControl()}</div>
      </div>
    </header>
    ${communityPanel(state.venues)}
    ${previewBanner}
    ${discoveryBar(list, loading)}
    ${
      loading
        ? city.presentation === 'map'
          ? `<section class="map-stage" aria-label="${esc(city.name)} map"><div class="map-panel map-panel-live"><p class="map-empty">Drawing the map of ${esc(city.name)}…</p></div></section>`
          : `<section class="list-preview" aria-label="${esc(city.name)} preview"><p class="map-empty">Preparing the ${esc(city.name)} selection…</p></section>`
        : city.presentation === 'map'
          ? mapStage(list)
          : listPreviewStage()
    }
    <section class="results" id="selection-results" aria-label="The selection">
      ${
        loading
          ? '<p class="loading">Gathering the current selection…</p>'
          : list.length
            ? `<ul class="card-list">${list.map(venueCard).join('')}</ul>`
            : emptyState
      }
    </section>
    <footer class="footer">
      <p>${esc(city.footer)}</p>
    </footer>
  `;

  bindCommunity(root, state.venues, () => render(root));

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
  const searchInput = root.querySelector<HTMLInputElement>('[data-search]');
  searchInput?.addEventListener('input', () => {
    state.search = searchInput.value;
    keepSelectionValid();
    const caret = searchInput.selectionStart;
    render(root);
    // Re-rendering replaces the input; restore focus and caret so typing
    // continues uninterrupted.
    const next = root.querySelector<HTMLInputElement>('[data-search]');
    if (next) {
      next.focus();
      if (caret !== null) next.setSelectionRange(caret, caret);
    }
  });
  root.querySelector<HTMLButtonElement>('[data-reset-filters]')?.addEventListener('click', () => {
    state.filter = '';
    state.sourceFilter = '';
    state.categoryFilter = '';
    state.search = '';
    pendingFocus = '[data-search]';
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
          : `[data-venue="${CSS.escape(closedId)}"]`;
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
  return `We couldn’t find your position, so the map stays on ${activeCity().name} — everything else works as usual.`;
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
        state.userLocation = { lat: latitude, lng: longitude };
        if (withinCity(activeCity(), state.userLocation)) {
          state.geoStatus = 'You’re on the map — look for the rose dot.';
        } else {
          state.geoStatus = `You seem to be outside ${activeCity().name}, so the map stays on the city — everything else works as usual.`;
        }
        savedView = null; // refit / recenter so the user sees their marker context
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
  render(root);
  loadLiveVenues()
    .then((venues) => {
      if (venues.length > 0) {
        state.mode = 'live';
        state.venues = venues;
        state.guideYear =
          venues.reduce(
            (y, v) => v.awards.reduce((yy, a) => Math.max(yy, a.awardYear), y),
            0
          ) || GUIDE_YEAR;
      } else {
        state.mode = 'demo';
        state.venues = demoVenues;
      }
      render(root);
    })
    .catch(() => {
      state.mode = 'demo';
      state.venues = demoVenues;
      render(root);
    });
}
