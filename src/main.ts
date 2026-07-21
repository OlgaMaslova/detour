import './styles.css';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { GUIDE_YEAR, citySlug, loadLiveCatalogue } from './data';
import type { Venue, VenueAward } from './data';
import { GLOBAL_META_DESCRIPTION, GLOBAL_META_TITLE } from './cities';
import { OCCASION_OPTIONS, occasionLabel } from './occasions';
import { bindCommunity, communityControl, communityPanel } from './community';

/** '' = all award levels; otherwise a literal level label present in the loaded data. */
type Filter = string;
type DataMode = 'loading' | 'live' | 'error';
type AppView = 'home' | 'destination' | 'account';

interface UserLocation {
  lat: number;
  lng: number;
}

interface State {
  mode: DataMode;
  /** Landing search, a destination's places, or the dedicated member area. */
  view: AppView;
  /** Active destination slug (derived from place data, e.g. 'madrid'); null on the landing. */
  destination: string | null;
  /** A searched destination with no coverage yet — rendered as the be-the-first invitation. */
  pendingDestination: string | null;
  /** Every loaded place, across all destinations. Never rendered directly — see destinationVenues(). */
  venues: Venue[];
  filter: Filter;
  /** '' = all sources; otherwise a source name present in the loaded data. */
  sourceFilter: string;
  /** '' = all categories; otherwise a venue category present in the loaded data (e.g. 'Pizza', 'Coffee'). */
  categoryFilter: string;
  /** San Francisco-only multi-select occasion browsing; selected values compose as AND. */
  occasionFilters: string[];
  selectedId: string | null;
  /** Whether the last selection came from a map pin or a list card — used to restore focus on close. */
  selectedVia: 'pin' | 'card' | null;
  /** Progressive-disclosure filter tray visibility. */
  trayOpen: boolean;
  /** Whether the full filtered selection is currently revealed. */
  selectionOpen: boolean;
  guideYear: number;
  userLocation: UserLocation | null;
  geoStatus: string;
  geoBusy: boolean;
}

const state: State = {
  mode: 'loading',
  view: new URL(window.location.href).searchParams.get('view') === 'members' ? 'account' : 'home',
  destination: null,
  pendingDestination: null,
  venues: [],
  filter: '',
  sourceFilter: '',
  categoryFilter: '',
  occasionFilters: [],
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

function cssToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/* ---------- helpers ---------- */

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Defense in depth for every external catalogue link rendered into HTML. */
function safeExternalHref(value: string | undefined): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function venueRouteName(v: Venue): string {
  return v.market || v.city;
}

function venueRouteSlug(v: Venue): string {
  return v.marketSlug || citySlug(venueRouteName(v));
}

function hasDistinctLocality(v: Venue): boolean {
  return citySlug(v.city) !== venueRouteSlug(v);
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

/* ---------- recognition provenance (public only) ---------- */

/** The exact visible phrase used everywhere a community selection is shown. */
const COMMUNITY_LABEL = 'Detour community selection';
/** The exact visible phrase used everywhere a publication-backed local pick is shown. */
const EDITORIAL_LABEL = 'Editorial local pick';
const LOCAL_MEMBER_TEXT = 'Recommended by a local member';
/** The exact visible phrase used for approved public member contributions. */
const LOCAL_MEMBER_LABEL = `${LOCAL_MEMBER_TEXT}.`;
const LOCAL_MEMBER_FILTER = '__local_member_recommendation__';

function isEditorialAward(a: VenueAward): boolean {
  return a.provenance === 'editorial_local_pick';
}

/** Whether the venue holds a current Detour community selection. */
function hasCommunityAward(v: Venue): boolean {
  return v.awards.some((a) => a.community);
}

/** Whether ALL of the venue's recognition is community provenance (no external guide). */
function onlyCommunityAwards(v: Venue): boolean {
  return v.awards.length > 0 && v.awards.every((a) => a.community);
}

function hasEditorialAward(v: Venue): boolean {
  return v.awards.some(isEditorialAward);
}

function onlyEditorialAwards(v: Venue): boolean {
  return v.awards.length > 0 && v.awards.every(isEditorialAward);
}

function hasGuideBackedAward(v: Venue): boolean {
  return v.awards.some(
    (a) => a.provenance === 'guide_backed' && !a.community && !a.sourceBadge
  );
}

function hasLocalMemberRecommendation(v: Venue): boolean {
  return v.localMemberRecommendation === true;
}

function venueOccasions(v: Venue): string[] {
  return v.occasions ?? [];
}

function occasionSummary(v: Venue): string {
  return venueOccasions(v).map(occasionLabel).join(', ');
}

function spokenAwardSummary(v: Venue): string {
  return awardSummary(v).replace(/[.!?]+$/, '');
}

/** Plain-text award/source label: ranked guide wording, provenance label, or literal level. */
function awardText(a: VenueAward): string {
  if (a.community) return COMMUNITY_LABEL;
  if (isEditorialAward(a)) return EDITORIAL_LABEL;
  return a.listRank !== null ? `No. ${a.listRank} — ${a.edition}` : a.awardLevel;
}

/** Plain-text summary of live source badges and any retained recognition metadata. */
function awardSummary(v: Venue): string {
  const summary = v.awards.map((a) => {
    if (a.community) return COMMUNITY_LABEL;
    if (isEditorialAward(a)) return `${EDITORIAL_LABEL} — ${a.sourceName}`;
    if (a.sourceBadge) return `Source badge: ${a.sourceName}`;
    return `${awardText(a)} — ${a.sourceName} ${a.awardYear}`;
  });
  if (hasLocalMemberRecommendation(v)) summary.push(LOCAL_MEMBER_LABEL);
  return summary.join('; ') || [v.category, v.city].filter(Boolean).join(' in ');
}

/** Unique EXTERNAL guide names for retained recognition metadata. */
function guideNames(v: Venue): string[] {
  return [
    ...new Set(
      v.awards
        .filter((a) => !a.community && !isEditorialAward(a) && !a.sourceBadge)
        .map((a) => a.sourceName)
        .filter(Boolean)
    ),
  ];
}

/** Unique publication names behind editorial local picks. */
function editorialSourceNames(v: Venue): string[] {
  return [
    ...new Set(
      v.awards
        .filter(isEditorialAward)
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

/* ---------- destination scoping (derived purely from place data) ---------- */

interface Destination {
  name: string;
  country: string;
  slug: string;
  count: number;
}

function allVenues(): Venue[] {
  return state.mode === 'live' ? state.venues : [];
}

/** Every destination with at least one published place, largest selection first. */
function destinations(): Destination[] {
  const bySlug = new Map<string, Destination>();
  for (const v of allVenues()) {
    const name = venueRouteName(v).trim();
    const slug = venueRouteSlug(v);
    if (!name || !slug) continue;
    const existing = bySlug.get(slug);
    if (existing) {
      existing.count += 1;
      if (!existing.country && v.country) existing.country = v.country;
    } else {
      bySlug.set(slug, { name, country: v.country, slug, count: 1 });
    }
  }
  return [...bySlug.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function destinationBySlug(slug: string): Destination | null {
  return destinations().find((d) => d.slug === slug) ?? null;
}

function activeDestination(): Destination | null {
  return state.destination ? destinationBySlug(state.destination) : null;
}

/** Display name for the active destination, covering uncovered searches too. */
function destinationLabel(): string {
  const active = activeDestination();
  if (active) return active.name;
  const pending = (state.pendingDestination || state.destination || '').trim();
  return pending ? pending.charAt(0).toUpperCase() + pending.slice(1) : '';
}

/**
 * The active destination's places — the only venue list any filter, count,
 * map, or detail render may derive from, so records from another destination
 * can never leak into the current view.
 */
function destinationVenues(): Venue[] {
  if (!state.destination) return [];
  return allVenues().filter((v) => venueRouteSlug(v) === state.destination);
}

function resetDestinationState(): void {
  state.filter = '';
  state.sourceFilter = '';
  state.categoryFilter = '';
  state.occasionFilters = [];
  state.selectedId = null;
  state.selectedVia = null;
  state.trayOpen = false;
  state.selectionOpen = false;
  state.geoStatus = '';
  state.geoBusy = false;
  savedView = null;
  savedPinKey = '';
}

function routeHref(view: AppView, slug: string | null): string {
  const url = new URL(window.location.href);
  url.searchParams.delete('city');
  if (view === 'destination' && slug) url.searchParams.set('d', slug);
  else url.searchParams.delete('d');
  if (view === 'account') url.searchParams.set('view', 'members');
  else url.searchParams.delete('view');
  return `${url.pathname}${url.search}${url.hash}`;
}

function homeHref(): string {
  return routeHref('home', null);
}

function destinationHref(slug: string): string {
  return routeHref('destination', slug);
}

function accountHref(): string {
  return routeHref('account', null);
}

function updateRoute(view: AppView, slug: string | null, mode: 'push' | 'replace'): void {
  const href = routeHref(view, slug);
  if (mode === 'push') window.history.pushState(null, '', href);
  else window.history.replaceState(null, '', href);
}

function openDestination(root: HTMLElement, slug: string, pendingName: string | null = null): void {
  if (slug !== state.destination) resetDestinationState();
  state.view = 'destination';
  state.destination = slug;
  state.pendingDestination = pendingName;
  updateRoute('destination', slug, 'push');
  pendingFocus = '#destination-title';
  render(root);
}

function showHome(root: HTMLElement): void {
  if (state.destination !== null) resetDestinationState();
  state.view = 'home';
  state.destination = null;
  state.pendingDestination = null;
  updateRoute('home', null, 'push');
  pendingFocus = '#destination-search';
  render(root);
}

function showAccount(root: HTMLElement): void {
  state.view = 'account';
  updateRoute('account', null, 'push');
  pendingFocus = '#account-title';
  render(root);
}

function returnToDiscovery(root: HTMLElement): void {
  state.view = state.destination ? 'destination' : 'home';
  updateRoute(state.view, state.destination, 'push');
  pendingFocus = '[data-community-route]';
  render(root);
}

function applyRouteFromUrl(root: HTMLElement): void {
  const url = new URL(window.location.href);
  const nextView: AppView = url.searchParams.get('view') === 'members' ? 'account' : 'home';
  // Legacy ?city= links resolve to the same destination.
  const requested = (url.searchParams.get('d') || url.searchParams.get('city') || '').trim().toLowerCase() || null;

  if (state.destination !== requested) resetDestinationState();
  state.destination = requested;
  state.pendingDestination = null;
  state.view = nextView === 'account' ? 'account' : requested ? 'destination' : 'home';

  if (url.searchParams.has('city')) updateRoute(state.view, requested, 'replace');
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
  for (const v of destinationVenues()) {
    for (const a of v.awards) {
      if (a.listRank !== null || a.sourceBadge) continue;
      if (!seen.has(a.awardLevel)) seen.set(a.awardLevel, a.awardRank);
    }
  }
  const levels = [...seen.entries()].sort(
    (a, b) => (b[1] ?? -1) - (a[1] ?? -1) || a[0].localeCompare(b[0])
  );
  const filters = [
    { value: '' as Filter, label: 'All' },
    ...levels.map(([level]) => ({ value: level as Filter, label: level })),
  ];
  if (destinationVenues().some(hasLocalMemberRecommendation)) {
    filters.push({ value: LOCAL_MEMBER_FILTER, label: LOCAL_MEMBER_LABEL });
  }
  return filters;
}

/** Stable category options present in the loaded data (e.g. 'Coffee', 'Pizza'). */
function categoryNames(): string[] {
  const names = new Set<string>();
  for (const v of destinationVenues()) if (v.category) names.add(v.category);
  return [...names].sort((a, b) => a.localeCompare(b));
}

function sourceNames(): string[] {
  const names = new Set<string>();
  for (const v of destinationVenues())
    for (const a of v.awards) if (a.sourceName) names.add(a.sourceName);
  return [...names].sort((a, b) => a.localeCompare(b));
}

function filteredVenues(): Venue[] {
  // A recognition filter matches when ANY of the venue's awards matches; the
  // approved local-member lane is explicit and never treated as a guide award.
  const list = destinationVenues().filter(
    (v) =>
      (state.filter === '' ||
        (state.filter === LOCAL_MEMBER_FILTER
          ? hasLocalMemberRecommendation(v)
          : v.awards.some((a) => a.awardLevel === state.filter))) &&
      (state.sourceFilter === '' ||
        v.awards.some((a) => a.sourceName === state.sourceFilter)) &&
      (state.categoryFilter === '' || v.category === state.categoryFilter) &&
      state.occasionFilters.every((occasion) => venueOccasions(v).includes(occasion))
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
  kind: 'award' | 'category' | 'source' | 'occasion';
  label: string;
  value: string;
}

function activeFilters(): ActiveFilter[] {
  const chips: ActiveFilter[] = [];
  if (state.filter)
    chips.push({
      kind: 'award',
      label: state.filter === LOCAL_MEMBER_FILTER ? LOCAL_MEMBER_LABEL : state.filter,
      value: state.filter,
    });
  if (state.categoryFilter)
    chips.push({ kind: 'category', label: state.categoryFilter, value: state.categoryFilter });
  if (state.sourceFilter)
    chips.push({ kind: 'source', label: state.sourceFilter, value: state.sourceFilter });
  for (const occasion of state.occasionFilters) {
    chips.push({ kind: 'occasion', label: occasionLabel(occasion), value: occasion });
  }
  return chips;
}

function isSanFranciscoDestination(): boolean {
  return state.destination === 'san-francisco';
}

/* ---------- interactive map (Leaflet + OpenStreetMap) ---------- */

type MappableVenue = Venue & { lat: number; lng: number };

/** Great-circle distance in kilometres. */
function distanceKm(a: UserLocation, b: UserLocation): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Whether the user's position is close enough to count as "in" the destination. */
function nearDestination(list: Venue[], p: UserLocation): boolean {
  return mappableVenues(list).some((v) => distanceKm(p, { lat: v.lat, lng: v.lng }) < 40);
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

  const mappable = mappableVenues(list);
  // A map only exists when there is at least one located place to show.
  if (mappable.length === 0) return;
  // Include the destination in the key so a destination switch always refits the map.
  const pinKey = `${state.destination ?? ''}::${mappable.map((v) => v.id).join('|')}`;
  if (pinKey !== savedPinKey) {
    savedPinKey = pinKey;
    savedView = null;
  }

  const map = L.map(container, {
    center: [mappable[0].lat, mappable[0].lng],
    zoom: 13,
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
    // Community-only venues keep a distinct outlined centre; venues that also
    // hold an external guide award retain that guide's ranked pearl treatment.
    const markerClass =
      markerRank > 0 ? `pin-${markerRank}` : onlyCommunityAwards(v) ? 'pin-community' : 'pin-ranked';
    const markerMeanings: string[] = [];
    if (markerRank > 0) markerMeanings.push(`${markerRank}-level guide recognition`);
    else if (hasGuideBackedAward(v)) markerMeanings.push('guide selection');
    if (hasEditorialAward(v)) markerMeanings.push(EDITORIAL_LABEL);
    if (hasCommunityAward(v)) markerMeanings.push(COMMUNITY_LABEL);
    if (hasLocalMemberRecommendation(v)) markerMeanings.push(LOCAL_MEMBER_TEXT);
    const markerMeaning = markerMeanings.join(' · ') || 'current selection';
    const icon = L.divIcon({
      className: '',
      html: `<span class="map-pin ${markerClass}${selected ? ' pin-selected' : ''}" data-pin="${esc(v.id)}">
        <span class="pin-pearl" aria-hidden="true">
          <span class="pin-signal"></span>
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
            : isEditorialAward(a)
              ? `<br>${esc(EDITORIAL_LABEL)} · ${esc(a.sourceName)}`
              : a.sourceBadge
                ? `<br>Source badge · ${esc(a.sourceName)}`
                : `<br>${awardIcons(a)} ${esc(awardText(a))} · ${esc(a.sourceName)} ${a.awardYear}`
        )
        .join('')}${hasLocalMemberRecommendation(v) ? `<br><span class="popup-member">${esc(LOCAL_MEMBER_LABEL)}</span>` : ''}${isSanFranciscoDestination() && venueOccasions(v).length ? `<br><span class="popup-occasions">Good for: ${esc(occasionSummary(v))}</span>` : ''}`,
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
          `${v.name}, ${spokenAwardSummary(v)}${isSanFranciscoDestination() && venueOccasions(v).length ? `. Good for ${occasionSummary(v)}` : ''}. ${selected ? 'Selected.' : 'Select for details.'}`
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
  // plausibly falls near the destination, so a distant visitor's marker never
  // appears on (or drags) another destination's map.
  const userNearby =
    state.userLocation !== null && nearDestination(list, state.userLocation);
  if (state.userLocation && userNearby) {
    L.circleMarker([state.userLocation.lat, state.userLocation.lng], {
      radius: 7,
      color: cssToken('--surface'),
      weight: 3,
      fillColor: cssToken('--location'),
      fillOpacity: 1,
    })
      .addTo(map)
      .bindTooltip('You are here');
  }

  // View: restore the user's last view, else fit the destination's real pins.
  if (savedView) {
    map.setView(savedView.center, savedView.zoom, { animate: false });
  } else {
    const bounds = L.latLngBounds(
      mappable.map((v) => [v.lat, v.lng] as [number, number])
    );
    // Frame the user's marker only when it is near the destination.
    const u = state.userLocation;
    if (u && userNearby) bounds.extend([u.lat, u.lng]);
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
    const name = destinationLabel();
    return name
      ? `Nothing matches at the moment — the map stays on ${name} while you adjust the filters.`
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
  const name = esc(destinationLabel() || 'Selection');
  return `<section class="map-stage" aria-label="${name} map">
    <div class="map-panel map-panel-live" role="group" aria-label="Interactive map of the ${name} selection">
      <div id="venue-map" class="venue-map" tabindex="-1" aria-label="${name} map"></div>
      ${note ? `<p class="map-note" role="status">${esc(note)}</p>` : ''}
    </div>
    ${detailPanel()}
  </section>`;
}

function listPreviewStage(): string {
  const name = esc(destinationLabel() || 'This selection');
  return `<section class="list-preview" aria-labelledby="list-preview-title">
    <p class="list-preview-kicker">Selection preview</p>
    <h2 id="list-preview-title">${name}, in the list first.</h2>
    <p>Map positions for these places are still being verified, so this selection is presented as a list rather than a map.</p>
    ${detailPanel()}
  </section>`;
}

function occasionBrowser(): string {
  if (!isSanFranciscoDestination()) return '';
  const venues = destinationVenues();
  const buttons = OCCASION_OPTIONS.map(([value, label]) => {
    const active = state.occasionFilters.includes(value);
    // Faceted counts: what the list becomes with this occasion in the mix.
    const withThis = active ? state.occasionFilters : [...state.occasionFilters, value];
    const count = venues.filter((venue) => withThis.every((occasion) => venueOccasions(venue).includes(occasion))).length;
    const disabled = !active && count === 0;
    return `<button type="button" class="occasion-option${active ? ' occasion-option-active' : ''}" data-occasion="${esc(value)}" aria-pressed="${active}"${disabled ? ' disabled' : ''} aria-label="${esc(label)}, ${count} ${count === 1 ? 'place' : 'places'}">
      <span>${esc(label)}</span><small aria-hidden="true">${count}</small>
    </button>`;
  }).join('');
  return `<section class="occasion-browser" aria-labelledby="occasion-browser-title" aria-describedby="occasion-browser-help">
    <div class="occasion-browser-copy">
      <h2 id="occasion-browser-title">What kind of stop is this?</h2>
      <p id="occasion-browser-help">Combine as many as apply — counts update with your picks.</p>
    </div>
    <div class="occasion-options" role="group" aria-label="Browse San Francisco by occasion">
      <button type="button" class="occasion-option occasion-option-all${state.occasionFilters.length === 0 ? ' occasion-option-active' : ''}" data-occasion="" aria-pressed="${state.occasionFilters.length === 0}">
        <span>All occasions</span><small aria-hidden="true">${destinationVenues().length}</small>
      </button>
      ${buttons}
    </div>
  </section>`;
}

function refineChips(): string {
  const chips = activeFilters();
  if (chips.length === 0) return '';
  return `<div class="chips" aria-label="Active filters">
    ${chips
      .map(
        (c) => `<button type="button" class="chip" data-chip="${c.kind}" data-chip-value="${esc(c.value)}"
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

function destinationSelector(): string {
  return `<div class="city-control">
      <label class="visually-hidden" for="destination-select">Destination</label>
      <select id="destination-select" data-destination-select>
        ${destinations()
          .map(
            (d) =>
              `<option value="${esc(d.slug)}"${d.slug === state.destination ? ' selected' : ''}>${esc(d.name)}${d.country ? `, ${esc(d.country)}` : ''}</option>`
          )
          .join('')}
      </select>
    </div>`;
}

function discoveryBar(list: Venue[], hasMap: boolean): string {
  const activeCount = activeFilters().length;
  return `<section class="discovery" aria-label="Explore the selection">
    <div class="discovery-row">
      <a class="all-cities-control" href="${esc(homeHref())}" data-home>Search</a>
      ${destinationSelector()}
      <button type="button" class="refine-btn${activeCount ? ' refine-btn-active' : ''}" data-tray-toggle
        aria-expanded="${state.trayOpen}" aria-controls="filter-tray">
        Refine${activeCount ? ` <span class="refine-count">${activeCount}</span>` : ''}
      </button>
      ${
        hasMap
          ? `<button type="button" class="nearby-btn" data-geolocate ${state.geoBusy ? 'disabled' : ''}>
              ${state.geoBusy ? 'Finding you…' : 'Show nearby'}
            </button>`
          : ''
      }
      <span class="count" aria-live="polite">${list.length} ${list.length === 1 ? 'place' : 'places'}</span>
    </div>
    ${occasionBrowser()}
    ${filterTray()}
    ${refineChips()}
    ${state.geoStatus ? `<p class="geo-status" role="status">${esc(state.geoStatus)}</p>` : ''}
  </section>`;
}

function venueCard(v: Venue): string {
  const selected = v.id === state.selectedId;
  const rank = maxAwardRank(v);
  const distinctLocality = hasDistinctLocality(v);
  const cardTone =
    rank > 0
      ? ` card-rank-${rank}`
      : onlyCommunityAwards(v)
        ? ' card-community'
        : hasLocalMemberRecommendation(v) && v.awards.length === 0
          ? ' card-member'
          : ' card-ranked';
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
                  : isEditorialAward(a)
                    ? `<span role="listitem" class="award award-ranked" title="${esc(EDITORIAL_LABEL)} — ${esc(a.sourceName)}">${esc(EDITORIAL_LABEL)}</span>`
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
            ${hasLocalMemberRecommendation(v) ? `<span role="listitem" class="award award-member" title="${esc(LOCAL_MEMBER_LABEL)}">${esc(LOCAL_MEMBER_LABEL)}</span>` : ''}
          </span>
        </div>
        <p class="card-meta">${esc([v.category, v.neighborhood].filter(Boolean).join(' · '))}</p>
        ${distinctLocality ? `<p class="card-locality"><span>${esc(v.city)}</span><small>${esc(venueRouteName(v))} selection</small></p>` : ''}
        <p class="card-address">${
          v.address
            ? esc(v.address)
            : '<span class="approx">Map position being refined</span>'
        }</p>
        ${isSanFranciscoDestination() && venueOccasions(v).length ? `<span class="card-occasions" aria-label="Good for ${esc(occasionSummary(v))}"><span class="card-occasions-label">Good for</span>${venueOccasions(v).map((occasion) => `<span>${esc(occasionLabel(occasion))}</span>`).join('')}</span>` : ''}
      </button>
      <div class="card-sources">
        ${v.awards
          .map((a) => {
            const sourceUrl = safeExternalHref(a.sourceUrl);
            if (a.community)
              return `<p class="card-source card-source-community"><span aria-hidden="true">❦</span> ${esc(COMMUNITY_LABEL)} — Detour’s editorial selection</p>`;
            if (isEditorialAward(a))
              return `<p class="card-source">${esc(EDITORIAL_LABEL)} · ${esc(a.sourceName)}${
                sourceUrl
                  ? ` — <a href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">Source/list ↗</a>`
                  : ''
              }</p>`;
            if (a.sourceBadge)
              return `<p class="card-source card-source-badge ${sourceBadgeClass(a.sourceName)}"><span>Source badge</span> · ${esc(a.sourceName)}</p>`;
            const claim =
              a.listRank !== null
                ? `No. ${a.listRank} · ${esc(a.edition)}`
                : `${esc(a.awardLevel)} · ${esc(a.sourceName)} ${a.awardYear}`;
            return `<p class="card-source">${claim}${
              sourceUrl
                ? ` — <a href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">Official guide ↗</a>`
                : ''
            }</p>`;
          })
          .join('')}
        ${hasLocalMemberRecommendation(v) ? `<p class="card-source card-source-member">${esc(LOCAL_MEMBER_LABEL)}</p>` : ''}
      </div>
    </article>
  </li>`;
}

function detailPanel(): string {
  const v = destinationVenues().find((x) => x.id === state.selectedId);
  if (!v) {
    const prompt =
      mappableVenues(destinationVenues()).length > 0
        ? 'Choose a pin on the map — or open the full selection — to see more.'
        : 'Open the full selection and choose a place to see more.';
    return `<p class="map-prompt" aria-live="polite">${prompt}</p>`;
  }
  const guides = guideNames(v);
  const editorialSources = editorialSourceNames(v);
  const communityHere = hasCommunityAward(v);
  const memberHere = hasLocalMemberRecommendation(v);
  const distinctLocality = hasDistinctLocality(v);
  const detailMeta = [v.category, v.neighborhood, distinctLocality ? v.city : '']
    .filter(Boolean)
    .join(' · ');
  const officialUrl = safeExternalHref(v.officialUrl);
  const instagramUrl = safeExternalHref(v.instagramUrl);
  const visitLinks = [
    officialUrl
      ? `<a href="${esc(officialUrl)}" target="_blank" rel="noopener noreferrer">Official website <span aria-hidden="true">↗</span></a>`
      : '',
    instagramUrl
      ? `<a href="${esc(instagramUrl)}" target="_blank" rel="noopener noreferrer">Instagram <span aria-hidden="true">↗</span></a>`
      : '',
  ].filter(Boolean).join('');
  const sentences: string[] = [];
  if (guides.length > 0)
    sentences.push(`A current selection, independently recognised by ${guides.join(' and ')}.`);
  if (editorialSources.length > 0)
    sentences.push(
      `${editorialSources.length === 1 ? 'An editorial local pick' : 'Editorial local picks'} attributed to ${editorialSources.join(' and ')}.`
    );
  if (communityHere)
    sentences.push(
      guides.length > 0
        ? 'Also a Detour community selection, selected editorially by Detour.'
        : 'A Detour community selection, selected editorially by Detour.'
    );
  if (memberHere) sentences.push(LOCAL_MEMBER_LABEL);
  const provenanceSentence = sentences.join(' ');
  return `<aside class="detail" id="selected-place-detail" aria-live="polite" aria-label="Selected place">
    <div class="detail-head">
      <div>
        <p class="detail-overline">Selected place</p>
        <h2>${esc(v.name)}</h2>
        ${detailMeta ? `<p class="detail-meta">${esc(detailMeta)}</p>` : ''}
      </div>
      <button type="button" class="detail-close" data-close aria-label="Close details"><span aria-hidden="true">×</span></button>
    </div>
    <div class="detail-body">
      <section class="detail-recognition" aria-labelledby="detail-recognition-title">
        <h3 id="detail-recognition-title">Why it’s here</h3>
        ${
          v.awards.length || memberHere
            ? `<ul class="detail-awards" aria-label="Source badges, recognition, and recommendation provenance">
          ${v.awards
            .map((a) =>
              a.community
                ? `<li class="detail-award detail-award-community"><span aria-hidden="true">◆</span> ${esc(COMMUNITY_LABEL)}</li>`
                : isEditorialAward(a)
                  ? `<li class="detail-award detail-award-ranked">${esc(EDITORIAL_LABEL)} · ${esc(a.sourceName)}</li>`
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
          ${memberHere ? `<li class="detail-award detail-award-member">${esc(LOCAL_MEMBER_LABEL)}</li>` : ''}
        </ul>`
            : ''
        }
        ${v.description ? `<p class="detail-description">${esc(v.description)}</p>` : ''}
        ${provenanceSentence ? `<p class="detail-note">${esc(provenanceSentence)}</p>` : ''}
      </section>
      <section class="detail-practical" aria-labelledby="detail-practical-title">
        <h3 id="detail-practical-title">Place details</h3>
        <dl class="detail-facts">
          <div><dt>Address</dt><dd>${
            v.address
              ? esc(v.address)
              : '<span class="approx">Map position being refined</span>'
          }</dd></div>
          ${distinctLocality ? `<div><dt>Locality</dt><dd><span class="detail-locality">${esc(v.city)}</span><span class="detail-market">${esc(venueRouteName(v))} selection</span></dd></div>` : ''}
          ${isSanFranciscoDestination() && venueOccasions(v).length ? `<div><dt>Good for</dt><dd>${esc(venueOccasions(v).map(occasionLabel).join(' · '))}</dd></div>` : ''}
          ${(() => {
            // Only retained external-guide recognition belongs under “Official guide”.
            const external = v.awards.filter(
              (a) => !a.community && !isEditorialAward(a) && !a.sourceBadge
            );
            const editorial = v.awards.filter(isEditorialAward);
            const guideRow = external.length
              ? `<div><dt>Official guide${external.length === 1 ? '' : 's'}</dt><dd>${external
                  .map((a) => {
                    const sourceUrl = safeExternalHref(a.sourceUrl);
                    return sourceUrl
                      ? `<a href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(a.sourceName)} ${a.awardYear} ↗</a>`
                      : `${esc(a.sourceName)} ${a.awardYear}`;
                  })
                  .join('<br>')}</dd></div>`
              : '';
            const editorialRow = editorial.length
              ? `<div><dt>Editorial source${editorial.length === 1 ? '' : 's'}</dt><dd>${editorial
                  .map((a) => {
                    const sourceUrl = safeExternalHref(a.sourceUrl);
                    return sourceUrl
                      ? `<a href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(a.sourceName)} source/list ↗</a>`
                      : esc(a.sourceName);
                  })
                  .join('<br>')}</dd></div>`
              : '';
            const communityRow = communityHere
              ? `<div><dt>Community</dt><dd>${esc(COMMUNITY_LABEL)} — Detour’s editorial selection</dd></div>`
              : '';
            const memberRow = memberHere
              ? `<div><dt>Local member</dt><dd>${esc(LOCAL_MEMBER_LABEL)}</dd></div>`
              : '';
            return guideRow + editorialRow + communityRow + memberRow;
          })()}
        </dl>
        ${visitLinks ? `<nav class="detail-visit" aria-labelledby="detail-visit-title"><h3 id="detail-visit-title">Visit</h3><div class="detail-visit-links">${visitLinks}</div></nav>` : ''}
      </section>
    </div>
  </aside>`;
}

/* ---------- render ---------- */

/** Keep the browser tab title and description in step with the current route. */
function syncDocumentMeta(destinationName: string | null, account = false): void {
  document.title = account
    ? 'Members — Detour'
    : destinationName
      ? `Detour — ${destinationName}’s exceptional tables`
      : GLOBAL_META_TITLE;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (meta) {
    meta.setAttribute(
      'content',
      account
        ? 'Sign in to Detour membership to manage invitations, recommend places, and exchange private place shares.'
        : destinationName
          ? destinationName === 'San Francisco'
            ? 'Browse Detour’s San Francisco selection by occasion, with guide recognition, editorial local picks, Detour community selections, and approved local-member recommendations clearly attributed.'
            : `Explore Detour’s current ${destinationName} selection: exceptional tables with published recognition from named guides or the Detour community.`
          : GLOBAL_META_DESCRIPTION
    );
  }
}

function bindRouteLinks(root: HTMLElement): void {
  root.querySelectorAll<HTMLAnchorElement>('[data-community-route]').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (state.view !== 'account') showAccount(root);
    });
  });
  root.querySelectorAll<HTMLAnchorElement>('[data-return-discovery]').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      returnToDiscovery(root);
    });
  });
  root.querySelectorAll<HTMLElement>('[data-open-destination]').forEach((el) => {
    el.addEventListener('click', (event) => {
      if (event instanceof MouseEvent && (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
      const slug = el.dataset.openDestination?.trim().toLowerCase() ?? '';
      if (!slug) return;
      event.preventDefault();
      openDestination(root, slug);
    });
  });
  root.querySelectorAll<HTMLAnchorElement>('[data-home]').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      showHome(root);
    });
  });
}

function renderAccount(root: HTMLElement): void {
  destroyMap();
  syncDocumentMeta(null, true);
  root.innerHTML = `
    <a class="skip-link" href="#community-area">Skip to member area</a>
    <header class="account-masthead">
      <div class="account-nav-row">
        <a class="account-brand" href="${esc(homeHref())}" data-return-discovery>Detour</a>
        <nav class="account-nav" aria-label="Member navigation">
          ${communityControl(accountHref(), true)}
        </nav>
      </div>
      <div class="account-intro">
        <p class="account-kicker">Private member area</p>
        <h1 id="account-title" tabindex="-1">Your Detour, one thing at a time.</h1>
        <p>Move between invitations, your place activity, and settings without the rest competing for attention.</p>
      </div>
    </header>
    ${communityPanel(state.venues)}
    <footer class="footer account-footer">
      <p>Introductions, personal notes, and participant identities stay private. Three independent recommendations publish a place into the shared selection.</p>
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

/**
 * Resolves a free-text landing search to a destination or a single place.
 * Matching is case-insensitive over route markets, physical localities,
 * place names, and the 'Place — Locality' datalist form. Physical-locality
 * matches still open the venue's market route when those names differ.
 */
function resolveSearch(query: string): { slug: string; venueId?: string } | null {
  const norm = (value: string) => value.trim().toLowerCase();
  const q = norm(query);
  if (!q) return null;
  for (const d of destinations()) {
    if (norm(d.name) === q || norm(`${d.name}, ${d.country}`) === q) return { slug: d.slug };
  }
  const venues = allVenues();
  const byLocality = venues.find(
    (v) => norm(v.city) === q || norm(`${v.city}, ${v.country}`) === q
  );
  if (byLocality) return { slug: venueRouteSlug(byLocality) };
  const byCombo = venues.find((v) => norm(`${v.name} — ${v.city}`) === q);
  if (byCombo) return { slug: venueRouteSlug(byCombo), venueId: byCombo.id };
  const byName = venues.filter((v) => norm(v.name) === q);
  if (byName.length >= 1) return { slug: venueRouteSlug(byName[0]), venueId: byName[0].id };
  return null;
}

function renderHome(root: HTMLElement): void {
  destroyMap();
  syncDocumentMeta(null);
  const covered = destinations();
  const status =
    state.mode === 'loading'
      ? '<p class="city-chooser-status loading" role="status">Checking the current published selection…</p>'
      : state.mode === 'error'
        ? '<p class="city-chooser-status status-banner" role="status">The current selection could not be loaded. Please try again shortly.</p>'
        : covered.length === 0
          ? '<p class="city-chooser-status" role="status">No places are published at the moment. Please return soon.</p>'
          : '';
  const searchOptions =
    state.mode !== 'live'
      ? ''
      : covered
          .map((d) => `<option value="${esc(d.country ? `${d.name}, ${d.country}` : d.name)}"></option>`)
          .join('') +
        [...new Set(allVenues().filter(hasDistinctLocality).map((v) => v.city))]
          .sort((a, b) => a.localeCompare(b))
          .map((city) => `<option value="${esc(city)}"></option>`)
          .join('') +
        allVenues()
          .map((v) => `<option value="${esc(`${v.name} — ${v.city}`)}"></option>`)
          .join('');
  const coverage =
    state.mode !== 'live'
      ? ''
      : `<ul class="city-choices" id="destination-choices" aria-label="Destinations with published places">
          ${covered
            .map(
              (d) => `<li class="city-choice city-choice-${esc(d.slug)}">
                <a class="city-choice-content" href="${esc(destinationHref(d.slug))}" data-open-destination="${esc(d.slug)}">
                  <span class="city-choice-swatch" aria-hidden="true"><span></span></span>
                  <p class="city-choice-place"><span class="city-choice-name">${esc(d.name)}</span>${d.country ? `<span class="city-choice-separator">, </span><span class="city-choice-country">${esc(d.country)}</span>` : ''}</p>
                  <p class="city-choice-count">${d.count} current ${d.count === 1 ? 'selection' : 'selections'}</p>
                </a>
              </li>`
            )
            .join('')}
        </ul>`;

  root.innerHTML = `
    <a class="skip-link" href="#destination-search">Skip to destination search</a>
    <header class="hero city-chooser-hero">
      <div class="hero-inner city-chooser-header">
        <p class="brand">Detour</p>
        <h1>Where is your next detour?</h1>
        <p class="tagline city-chooser-intro">A collection of exceptional tables with clear provenance — from named guides and editorial sources to Detour community selections and approved local-member recommendations.</p>
        <form class="destination-search" data-destination-search role="search" aria-label="Find a destination or place">
          <label class="visually-hidden" for="destination-search">Destination or place</label>
          <input id="destination-search" name="query" type="search" list="destination-search-options" autocomplete="off" spellcheck="false" placeholder="A city or a place — Madrid, Casa Botín…" ${state.mode !== 'live' ? 'disabled' : ''}>
          <datalist id="destination-search-options">${searchOptions}</datalist>
          <button class="destination-go" type="submit" ${state.mode !== 'live' ? 'disabled' : ''}>Go</button>
          <button class="destination-near" type="button" data-geolocate ${state.geoBusy || state.mode !== 'live' ? 'disabled' : ''}>${state.geoBusy ? 'Finding you…' : 'Near me'}</button>
        </form>
        ${state.geoStatus ? `<p class="geo-status" role="status">${esc(state.geoStatus)}</p>` : ''}
      </div>
      <div class="hero-account">${communityControl(accountHref())}</div>
    </header>
    <section class="city-chooser" aria-labelledby="destination-choices-title">
      <div class="city-chooser-heading">
        <h2 id="destination-choices-title">Where Detour is today</h2>
        <p>Every destination below has current published places with clear provenance.</p>
      </div>
      ${status}
      ${coverage}
    </section>
    <section class="city-chooser community-cta" aria-label="Member community">
      <div class="city-chooser-heading">
        <h2>Nowhere near you yet?</h2>
        <p>Detour is member-driven — places join the list when 3 members recommend them. <a href="${esc(accountHref())}" data-community-route>Recommend the first one ↗</a></p>
      </div>
    </section>
    <footer class="footer city-chooser-footer">
      <p>Independent guides keep their own voice and attribution. Detour brings their current selections together in one deliberately edited collection.</p>
    </footer>
  `;

  bindRouteLinks(root);
  root.querySelector<HTMLFormElement>('[data-destination-search]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = root.querySelector<HTMLInputElement>('#destination-search');
    const query = input?.value ?? '';
    const resolved = resolveSearch(query);
    if (resolved) {
      state.geoStatus = '';
      openDestination(root, resolved.slug);
      if (resolved.venueId) {
        state.selectedId = resolved.venueId;
        state.selectedVia = 'card';
        state.selectionOpen = true;
        render(root);
      }
      return;
    }
    if (query.trim()) {
      // An uncovered destination is an invitation, not a dead end.
      openDestination(root, citySlug(query), query.trim());
    }
  });
  root.querySelector<HTMLButtonElement>('[data-geolocate]')?.addEventListener('click', () => {
    requestNearestDestination(root);
  });
  if (pendingFocus) {
    const target = root.querySelector<HTMLElement>(pendingFocus);
    pendingFocus = null;
    target?.focus({ preventScroll: true });
  }
}

function render(root: HTMLElement) {
  if (state.view === 'account') {
    renderAccount(root);
    return;
  }

  const destination = activeDestination();
  if (state.mode === 'loading' || state.view === 'home' || !state.destination) {
    renderHome(root);
    return;
  }

  // A destination with no coverage yet is an invitation, not a dead end.
  if (!destination) {
    const name = destinationLabel() || 'this destination';
    syncDocumentMeta(name);
    destroyMap();
    root.innerHTML = `
      <header class="hero city-detail-hero">
        <div class="hero-inner">
          <a class="brand" href="${esc(homeHref())}" data-home>Detour</a>
          <h1 id="destination-title" tabindex="-1">${esc(name)}, not yet.</h1>
          <p class="tagline">No published places here so far — Detour grows wherever its members eat well.</p>
        </div>
        <div class="hero-account">${communityControl(accountHref())}</div>
      </header>
      <section class="city-chooser" aria-label="No coverage yet">
        <div class="city-chooser-heading">
          <h2>Be the first</h2>
          <p>A place joins the list once 3 members recommend it. <a href="${esc(accountHref())}" data-community-route>Recommend a place in ${esc(name)} ↗</a></p>
        </div>
        <p class="city-chooser-status"><a href="${esc(homeHref())}" data-home>← Back to search</a></p>
      </section>
      <footer class="footer city-chooser-footer">
        <p>Independent guides keep their own voice and attribution. Detour brings their current selections together in one deliberately edited collection.</p>
      </footer>
    `;
    bindRouteLinks(root);
    if (pendingFocus) {
      const target = root.querySelector<HTMLElement>(pendingFocus);
      pendingFocus = null;
      target?.focus({ preventScroll: true });
    }
    return;
  }

  syncDocumentMeta(destination.name);
  const list = filteredVenues();
  const hasMap = mappableVenues(destinationVenues()).length > 0;
  const emptyState = `<div class="empty-state" role="status">
      <p class="empty-state-title">Nothing matches yet</p>
      <p class="empty-state-body">Adjust the filters, or start again with the full ${esc(destination.name)} selection.</p>
      <button type="button" class="empty-state-reset" data-reset-filters>Show everything</button>
    </div>`;
  const selectionLabel = `${list.length} ${list.length === 1 ? 'place' : 'places'}`;
  const sanFrancisco = isSanFranciscoDestination();
  const destinationTitle = sanFrancisco
    ? 'San Francisco, for the plan you have.'
    : `${destination.name}’s exceptional tables, selected.`;
  const destinationTagline = sanFrancisco
    ? `${destination.count} current ${destination.count === 1 ? 'place' : 'places'}. Browse by occasion, from celebrations and date nights to neighborhood meals and quick local stops.`
    : `${destination.count} current ${destination.count === 1 ? 'place' : 'places'} holding published recognition.`;

  root.innerHTML = `
    <a class="skip-link" href="${hasMap ? '#venue-map' : '#selection-disclosure-title'}">Skip to discovery</a>
    <header class="hero city-detail-hero">
      <div class="hero-inner">
        <a class="brand" href="${esc(homeHref())}" data-home>Detour</a>
        <h1 id="destination-title" tabindex="-1">${esc(destinationTitle)}</h1>
        <p class="tagline">${esc(destinationTagline)}</p>
      </div>
      <div class="hero-account">${communityControl(accountHref())}</div>
    </header>
    ${discoveryBar(list, hasMap)}
    ${hasMap ? mapStage(list) : listPreviewStage()}
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
      <p>Trusted sources, named. Take a detour.</p>
    </footer>
  `;

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
  root.querySelectorAll<HTMLButtonElement>('[data-occasion]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const occasion = btn.dataset.occasion ?? '';
      if (!occasion) state.occasionFilters = [];
      else if (state.occasionFilters.includes(occasion)) {
        state.occasionFilters = state.occasionFilters.filter((value) => value !== occasion);
      } else {
        state.occasionFilters = [...state.occasionFilters, occasion];
      }
      keepSelectionValid();
      pendingFocus = `[data-occasion="${CSS.escape(occasion)}"]`;
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
      if (kind === 'occasion') {
        const value = btn.dataset.chipValue ?? '';
        state.occasionFilters = state.occasionFilters.filter((occasion) => occasion !== value);
      }
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
      state.occasionFilters = [];
      pendingFocus = '[data-tray-toggle]';
      render(root);
    });
  });
  root.querySelector<HTMLButtonElement>('[data-geolocate]')?.addEventListener('click', () => {
    requestUserLocation(root);
  });
  const destinationSelect = root.querySelector<HTMLSelectElement>('[data-destination-select]');
  destinationSelect?.addEventListener('change', () => {
    const next = destinationSelect.value.trim().toLowerCase();
    if (destinationBySlug(next)) openDestination(root, next);
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
    state.occasionFilters = [];
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

  // (Re)create the Leaflet map only when the destination has located places.
  if (hasMap) mountMap(root, list);
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

function readPosition(
  onPosition: (p: UserLocation) => void,
  onFailure: () => void
): boolean {
  if (!('geolocation' in navigator)) return false;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      // Treat 0/0 (and non-finite values) as unknown — never plot them.
      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        (latitude === 0 && longitude === 0)
      ) {
        onFailure();
      } else {
        onPosition({ lat: latitude, lng: longitude });
      }
    },
    onFailure,
    { timeout: 10000, maximumAge: 60000 }
  );
  return true;
}

/** Destination-view "Show nearby": plots the user on the active map. */
function requestUserLocation(root: HTMLElement): void {
  if (state.geoBusy) return;
  const name = destinationLabel();
  const fallback = `We couldn’t find your position, so the map stays on ${name || 'the selection'} — everything else works as usual.`;
  const finish = () => {
    pendingFocus = '[data-geolocate]';
    render(root);
  };
  state.geoBusy = true;
  state.geoStatus = 'Finding places near you…';
  pendingFocus = '[data-geolocate]';
  render(root);
  const supported = readPosition(
    (position) => {
      state.geoBusy = false;
      state.userLocation = position;
      if (nearDestination(destinationVenues(), position)) {
        state.geoStatus = 'You’re on the map — look for the outlined location dot.';
      } else {
        state.geoStatus = `You seem to be outside ${name || 'this destination'}, so the map stays put — everything else works as usual.`;
      }
      savedView = null; // refit / recenter so the user sees their marker context
      finish();
    },
    () => {
      state.geoBusy = false;
      state.userLocation = null;
      state.geoStatus = fallback;
      finish();
    }
  );
  if (!supported) {
    state.geoBusy = false;
    state.userLocation = null;
    state.geoStatus = fallback;
    finish();
  }
}

/** Landing "Near me": jumps to the destination with the closest located place. */
function requestNearestDestination(root: HTMLElement): void {
  if (state.geoBusy) return;
  const fallback = 'We couldn’t find your position. Search for a destination instead.';
  state.geoBusy = true;
  state.geoStatus = 'Finding the selection nearest you…';
  pendingFocus = '[data-geolocate]';
  render(root);
  const supported = readPosition(
    (position) => {
      state.geoBusy = false;
      let nearest: { slug: string; name: string; km: number } | null = null;
      for (const v of mappableVenues(allVenues())) {
        const km = distanceKm(position, { lat: v.lat, lng: v.lng });
        if (!nearest || km < nearest.km) {
          nearest = { slug: venueRouteSlug(v), name: venueRouteName(v), km };
        }
      }
      if (!nearest) {
        state.geoStatus = 'No located places are published yet. Search for a destination instead.';
        pendingFocus = '[data-geolocate]';
        render(root);
        return;
      }
      state.userLocation = position;
      openDestination(root, nearest.slug);
      state.geoStatus =
        nearest.km < 40
          ? `You’re near ${nearest.name} — here is its current selection.`
          : `The closest selection is ${nearest.name}, about ${Math.round(nearest.km)} km away.`;
      render(root);
    },
    () => {
      state.geoBusy = false;
      state.userLocation = null;
      state.geoStatus = fallback;
      pendingFocus = '[data-geolocate]';
      render(root);
    }
  );
  if (!supported) {
    state.geoBusy = false;
    state.geoStatus = fallback;
    pendingFocus = '[data-geolocate]';
    render(root);
  }
}

/* ---------- boot ---------- */

const root = document.querySelector('#app');
if (root instanceof HTMLElement) {
  applyRouteFromUrl(root);
  window.addEventListener('popstate', () => applyRouteFromUrl(root));
  loadLiveCatalogue()
    .then(({ venues }) => {
      state.mode = 'live';
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
      state.venues = [];
      applyRouteFromUrl(root);
    });
}
