import './styles.css';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { citySlug, loadLiveCatalogue, venueMarketSlug, venuePlaceSlug } from './data';
import type { Venue } from './data';
import { GLOBAL_META_DESCRIPTION, GLOBAL_META_TITLE } from './cities';
import { OCCASION_OPTIONS, occasionLabel } from './occasions';
import {
  applyInvitationRoute,
  bindCommunity,
  communityControl,
  communityPanel,
  openMemberArea,
  openRecommendPlace,
  openSharePlace,
  signOutMember,
} from './community';
import { pb } from './pocketbase';
import {
  bindNetworkDiscovery,
  ensureNetworkDiscovery,
  markFirstPlaceContributed,
  networkDiscoveryMarkup,
  networkPlaceNotes,
  networkPlaceNotesState,
  resetNetworkDiscovery,
  retryNetworkPlaceNotes,
} from './network';
import { renderFoundingSurvey } from './survey';
import { PLACE_MAP_ID, placeIsLocated, placePageMarkup } from './place';
import { detouristSignalBadge, detouristSignalText } from './signal';
import type { PlaceChrome, PlaceHelpers } from './place';

type DataMode = 'loading' | 'live' | 'error';
type AppView = 'home' | 'explore' | 'country' | 'destination' | 'place' | 'account' | 'survey';
/** The two ways a destination's places can be browsed. */
type CityView = 'list' | 'map';

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
  /** Active country slug on the Explore country index; null elsewhere. */
  country: string | null;
  /** A searched destination with no coverage yet — rendered as the be-the-first invitation. */
  pendingDestination: string | null;
  /** Last unmatched Explore query, retained so the inline no-results state survives a render. */
  exploreQuery: string;
  /**
   * Place-page slug within the active destination (the `p` search param); null
   * on every other view. A place always resolves inside `destination`, so the
   * two are set and cleared together.
   */
  place: string | null;
  /** Every loaded place, across all destinations. Never rendered directly — see destinationVenues(). */
  venues: Venue[];
  /** Multi-select occasion browsing; selected values compose as AND. */
  occasionFilters: string[];
  selectedId: string | null;
  /** Whether the last selection came from a map pin or a list card — used to restore focus on close. */
  selectedVia: 'pin' | 'card' | null;
  /** How a destination is being browsed. The list leads; the map is one click away. */
  cityView: CityView;
  userLocation: UserLocation | null;
  geoStatus: string;
  geoBusy: boolean;
}

const state: State = {
  mode: 'loading',
  view: window.location.pathname.replace(/\/+$/, '') === '/survey'
    ? 'survey'
    : new URL(window.location.href).searchParams.get('view') === 'members'
      ? 'account'
      : 'home',
  destination: null,
  country: null,
  pendingDestination: null,
  exploreQuery: '',
  place: null,
  venues: [],
  occasionFilters: [],
  selectedId: null,
  selectedVia: null,
  cityView: 'list',
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
/** Guards the once-per-session document listeners that dismiss the member menu. */
let memberMenuDismissBound = false;

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
  return venueMarketSlug(v);
}

/** Shareable place-page slug, unique within the venue's market route. */
function venuePageSlug(v: Venue): string {
  return venuePlaceSlug(v, allVenues());
}

function hasDistinctLocality(v: Venue): boolean {
  return citySlug(v.city) !== venueRouteSlug(v);
}

/* ---------- brand ---------- */

/** Detour mark — keep in sync with the favicon artwork in index.html. */
function brandMark(): string {
  return `<svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><rect width="64" height="64" rx="12" fill="#6e5493"/><path d="M11 13h42v26H39L32 52l-7-13H11z" fill="#87c2a5"/><path d="M39 39h14V26z" fill="#86231e"/><path d="M24 22h16v6H24z" fill="#86231e"/></svg>`;
}

/* ---------- public member-list framing ---------- */

/**
 * The aggregate member signal — how many Detourists put this place on the list.
 * Both the badge and its plain-text form come from signal.ts, so the figure
 * reads identically on a card, in the map preview and on the place page. Shares
 * are private and never counted or named here.
 */
function venueSignalBadge(v: Venue): string {
  return detouristSignalBadge(v.detouristCount, 'inline');
}

function venueSignalText(v: Venue): string {
  return detouristSignalText(v.detouristCount);
}

function venueOccasions(v: Venue): string[] {
  return v.occasions ?? [];
}

function occasionSummary(v: Venue): string {
  return venueOccasions(v).map(occasionLabel).join(', ');
}

/* ---------- destination scoping (derived purely from place data) ---------- */

interface Destination {
  name: string;
  country: string;
  slug: string;
  count: number;
  recommendationCount: number;
}

interface DestinationCountry {
  name: string;
  slug: string;
  count: number;
  recommendationCount: number;
  destinations: Destination[];
}

// Six still reads as a deliberate shortlist rather than a directory, while
// keeping destinations with a meaningfully larger catalogue in the established
// exploration-first flow.
const SHORT_LIST_DESTINATION_MAX = 6;

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
      existing.recommendationCount += v.detouristCount ?? 0;
      if (!existing.country && v.country) existing.country = v.country;
    } else {
      bySlug.set(slug, {
        name,
        country: v.country,
        slug,
        count: 1,
        recommendationCount: v.detouristCount ?? 0,
      });
    }
  }
  return [...bySlug.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Every published country, with its destinations ranked by member signal first. */
function destinationCountries(): DestinationCountry[] {
  const bySlug = new Map<string, DestinationCountry>();
  for (const destination of destinations()) {
    const name = destination.country.trim() || 'Other destinations';
    const slug = citySlug(name) || 'other-destinations';
    const existing = bySlug.get(slug);
    if (existing) {
      existing.count += destination.count;
      existing.recommendationCount += destination.recommendationCount;
      existing.destinations.push(destination);
    } else {
      bySlug.set(slug, {
        name,
        slug,
        count: destination.count,
        recommendationCount: destination.recommendationCount,
        destinations: [destination],
      });
    }
  }
  for (const country of bySlug.values()) {
    country.destinations.sort(
      (a, b) =>
        b.recommendationCount - a.recommendationCount ||
        b.count - a.count ||
        a.name.localeCompare(b.name)
    );
  }
  return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function destinationCountryBySlug(slug: string | null): DestinationCountry | null {
  if (!slug) return null;
  return destinationCountries().find((country) => country.slug === slug) ?? null;
}

function destinationCountry(destination: Destination): DestinationCountry | null {
  const slug = citySlug(destination.country);
  return destinationCountryBySlug(slug);
}

function destinationBySlug(slug: string): Destination | null {
  return destinations().find((d) => d.slug === slug) ?? null;
}

function activeDestination(): Destination | null {
  return state.destination ? destinationBySlug(state.destination) : null;
}

function isShortListDestination(destination: Destination | null = activeDestination()): boolean {
  return Boolean(destination && destination.count <= SHORT_LIST_DESTINATION_MAX);
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

/**
 * The place the current route names, or null when the slug matches nothing in
 * the active destination (a stale link, or a place that has since moved
 * markets). Venue ids are accepted too, so links minted before readable place
 * slugs existed keep working.
 */
function activePlace(): Venue | null {
  if (!state.place) return null;
  const list = destinationVenues();
  return (
    list.find((v) => venuePageSlug(v) === state.place) ?? list.find((v) => v.id === state.place) ?? null
  );
}

function resetDestinationState(): void {
  state.occasionFilters = [];
  state.selectedId = null;
  state.selectedVia = null;
  state.cityView = 'list';
  state.geoStatus = '';
  state.geoBusy = false;
  savedView = null;
  savedPinKey = '';
}

function routeHref(
  view: AppView,
  slug: string | null,
  place: string | null = null,
  country: string | null = null
): string {
  const url = new URL(window.location.href);
  url.pathname = view === 'survey' ? '/survey' : '/';
  url.searchParams.delete('city');
  if ((view === 'destination' || view === 'place') && slug) url.searchParams.set('d', slug);
  else url.searchParams.delete('d');
  // A place page is a destination route plus the place itself, so a visitor who
  // strips `p` from the URL lands on the list the place belongs to.
  if (view === 'place' && slug && place) url.searchParams.set('p', place);
  else url.searchParams.delete('p');
  if (view === 'country' && country) url.searchParams.set('country', country);
  else url.searchParams.delete('country');
  if (view === 'account') url.searchParams.set('view', 'members');
  else if (view === 'explore' || view === 'country') {
    url.searchParams.set('view', 'explore');
    url.searchParams.delete('invite');
  }
  else {
    url.searchParams.delete('view');
    url.searchParams.delete('invite');
  }
  if (view === 'survey') url.hash = '';
  return `${url.pathname}${url.search}${url.hash}`;
}

function homeHref(): string {
  return routeHref('home', null);
}

function destinationHref(slug: string): string {
  return routeHref('destination', slug);
}

function exploreHref(): string {
  return routeHref('explore', null);
}

function countryHref(slug: string): string {
  return routeHref('country', null, null, slug);
}

function accountHref(): string {
  return routeHref('account', null);
}

/** Canonical URL of one place's own page. */
function placeHref(v: Venue): string {
  return routeHref('place', venueRouteSlug(v), venuePageSlug(v));
}

function updateRoute(
  view: AppView,
  slug: string | null,
  mode: 'push' | 'replace',
  place: string | null = null,
  country: string | null = null
): void {
  const href = routeHref(view, slug, place, country);
  if (mode === 'push') window.history.pushState(null, '', href);
  else window.history.replaceState(null, '', href);
}

function openDestination(root: HTMLElement, slug: string, pendingName: string | null = null): void {
  if (slug !== state.destination) resetDestinationState();
  state.view = 'destination';
  state.destination = slug;
  state.pendingDestination = pendingName;
  state.place = null;
  updateRoute('destination', slug, 'push');
  pendingFocus = '#destination-title';
  render(root);
}

/**
 * Opens one place's own page. Every card in the app leads here, from any view,
 * so a place reads the same whether it was found on the landing feed, in a
 * destination list, or from a member's own activity.
 */
function openPlace(root: HTMLElement, v: Venue): void {
  const slug = venueRouteSlug(v);
  if (slug !== state.destination) resetDestinationState();
  state.view = 'place';
  state.destination = slug;
  state.pendingDestination = null;
  state.place = venuePageSlug(v);
  // Kept so returning to the destination marks the place you just read.
  state.selectedId = v.id;
  state.selectedVia = 'card';
  updateRoute('place', slug, 'push', state.place);
  pendingFocus = '#place-title';
  window.scrollTo({ top: 0, behavior: 'auto' });
  render(root);
}

function showHome(root: HTMLElement): void {
  if (state.destination !== null) resetDestinationState();
  state.view = 'home';
  state.destination = null;
  state.country = null;
  state.pendingDestination = null;
  state.place = null;
  updateRoute('home', null, 'push');
  pendingFocus = '#network-home-title';
  render(root);
}

function showExplore(root: HTMLElement): void {
  if (state.destination !== null) resetDestinationState();
  state.view = 'explore';
  state.destination = null;
  state.country = null;
  state.pendingDestination = null;
  state.place = null;
  state.exploreQuery = '';
  updateRoute('explore', null, 'push');
  pendingFocus = '#explore-title';
  render(root);
}

function showCountry(root: HTMLElement, slug: string): void {
  if (state.destination !== null) resetDestinationState();
  state.view = 'country';
  state.destination = null;
  state.country = slug;
  state.pendingDestination = null;
  state.place = null;
  state.exploreQuery = '';
  updateRoute('country', null, 'push', null, slug);
  pendingFocus = '#country-title';
  render(root);
}

function showAccount(root: HTMLElement): void {
  state.view = 'account';
  updateRoute('account', null, 'push');
  pendingFocus = '#account-title';
  render(root);
}

function returnToDiscovery(root: HTMLElement): void {
  state.view = state.place && state.destination ? 'place' : state.destination ? 'destination' : 'home';
  updateRoute(state.view, state.destination, 'push', state.place);
  pendingFocus = '[data-community-route]';
  render(root);
}

function applyRouteFromUrl(root: HTMLElement): void {
  const url = new URL(window.location.href);
  const surveyPath = url.pathname.replace(/\/+$/, '') === '/survey';
  const invitationCode = surveyPath ? null : url.searchParams.get('invite');
  const requestedCountry = surveyPath
    ? null
    : (url.searchParams.get('country') || '').trim().toLowerCase() || null;
  const nextView: AppView = surveyPath
    ? 'survey'
    : url.searchParams.get('view') === 'members' || invitationCode?.trim()
      ? 'account'
      : url.searchParams.get('view') === 'explore'
        ? requestedCountry
          ? 'country'
          : 'explore'
      : 'home';
  // Legacy ?city= links resolve to the same destination.
  const requested = surveyPath
    ? null
    : (url.searchParams.get('d') || url.searchParams.get('city') || '').trim().toLowerCase() || null;
  const requestedPlace = surveyPath || !requested
    ? null
    : (url.searchParams.get('p') || '').trim().toLowerCase() || null;

  applyInvitationRoute(invitationCode);
  if (state.destination !== requested) resetDestinationState();
  state.destination = requested;
  state.country = requested ? null : requestedCountry;
  state.pendingDestination = null;
  state.place = requestedPlace;
  state.view =
    nextView === 'survey'
      ? 'survey'
      : nextView === 'account'
        ? 'account'
        : requested
          ? requestedPlace
            ? 'place'
            : 'destination'
          : nextView;

  if (!surveyPath && url.searchParams.has('city')) updateRoute(state.view, requested, 'replace', requestedPlace);
  render(root);
}

/* ---------- filters ---------- */

function filteredVenues(): Venue[] {
  const list = destinationVenues().filter((v) =>
    state.occasionFilters.every((occasion) => venueOccasions(v).includes(occasion))
  );
  return [...list].sort(
    (a, b) => a.name.localeCompare(b.name) || a.city.localeCompare(b.city) || a.address.localeCompare(b.address)
  );
}

interface ActiveFilter {
  kind: 'occasion';
  label: string;
  value: string;
}

function activeFilters(): ActiveFilter[] {
  return state.occasionFilters.map((occasion) => ({
    kind: 'occasion',
    label: occasionLabel(occasion),
    value: occasion,
  }));
}

/** Occasion browsing appears wherever the destination's venues carry occasion tags. */
function destinationHasOccasions(): boolean {
  return destinationVenues().some((v) => venueOccasions(v).length > 0);
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
  // Every teardown of the main map is a view change or a re-render; the
  // detail's locator map goes with it and is remounted below if still needed.
  destroyLocatorMap();
}

// The short-list detail panel carries its own locator map — the planning-tools
// map is collapsed by default there, so "where is it" is the one thing opening
// a place can add that the card does not already say.
let locatorMap: L.Map | null = null;

function destroyLocatorMap(): void {
  if (locatorMap) {
    locatorMap.remove();
    locatorMap = null;
  }
}

/**
 * The selected place, pinned. Zoom controls, dragging and touch zoom are on —
 * a locator you cannot zoom out of tells you the street but not the district.
 * Scroll-wheel zoom stays off so the map never hijacks page scrolling, and
 * Leaflet's attribution is suppressed in favour of visible credit copy.
 */
function mountLocatorMap(root: HTMLElement, v: Venue): void {
  destroyLocatorMap();
  const container = root.querySelector<HTMLElement>(`#${PLACE_MAP_ID}`);
  if (!container || v.lat === null || v.lng === null) return;

  const map = L.map(container, {
    center: [v.lat, v.lng],
    zoom: 16,
    zoomControl: true,
    attributionControl: false,
    scrollWheelZoom: false,
    boxZoom: false,
  });
  locatorMap = map;

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  L.marker([v.lat, v.lng], {
    icon: L.divIcon({
      className: '',
      html: `<span class="map-pin pin-detourist pin-selected" aria-hidden="true">
        <span class="pin-pearl"><span class="pin-signal"></span></span>
      </span>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    }),
    keyboard: false,
    interactive: false,
  }).addTo(map);
}

/**
 * Maps handoff for the selected place. Verified coordinates route to the exact
 * point; an approximate or missing position falls back to a name + address
 * search so the link never points at a pin we do not stand behind.
 */
function directionsHref(v: Venue): string {
  const precise = v.lat !== null && v.lng !== null && !v.approxLocation;
  const destination = precise
    ? `${v.lat},${v.lng}`
    : [v.name, v.address || v.city].filter(Boolean).join(', ');
  if (!destination) return '';
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
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

  // Venue pins — every public place uses the same member-list treatment.
  for (const v of mappable) {
    const selected = v.id === state.selectedId;
    const icon = L.divIcon({
      className: '',
      html: `<span class="map-pin pin-detourist${selected ? ' pin-selected' : ''}" data-pin="${esc(v.id)}">
        <span class="pin-pearl" aria-hidden="true">
          <span class="pin-signal"></span>
        </span>
        <span class="pin-label">${esc(v.name)}${v.category ? `<small>${esc(v.category)}</small>` : ''}</span>
      </span>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
    const marker = L.marker([v.lat, v.lng], {
      icon,
      keyboard: false,
      riseOnHover: true,
      zIndexOffset: selected ? 1000 : 0,
    }).addTo(map);
    const select = () => {
      const deselecting = state.selectedId === v.id;
      state.selectedId = deselecting ? null : v.id;
      state.selectedVia = deselecting ? null : 'pin';
      savedView = { center: map.getCenter(), zoom: map.getZoom() };
      pendingFocus = `[data-pin="${CSS.escape(v.id)}"]`;
      render(root);
      if (!deselecting) {
        root.querySelector('.map-stage .detail')?.scrollIntoView({
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          block: 'nearest',
        });
      }
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
          `${v.name}. ${venueSignalText(v)}.${venueOccasions(v).length ? ` Good for ${occasionSummary(v)}.` : ''} ${selected ? 'Selected.' : 'Select for details.'}`
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
    // A pan or zoom still in flight settles after a re-render has already torn
    // this map down, and a removed map has no pane left to measure. Identity,
    // not truthiness: by then leafletMap may hold the map that replaced it.
    if (leafletMap !== map) return;
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

function mapStage(list: Venue[], showDetail = true): string {
  const note = mapNote(list);
  const name = esc(destinationLabel() || 'Selection');
  return `<section class="map-stage" aria-label="${name} map">
    <div class="map-panel map-panel-live" role="group" aria-label="Interactive map of the ${name} selection">
      <div id="venue-map" class="venue-map" tabindex="-1" aria-label="${name} map"></div>
      ${note ? `<p class="map-note" role="status">${esc(note)}</p>` : ''}
    </div>
    ${showDetail ? detailPanel() : ''}
  </section>`;
}

function occasionBrowser(): string {
  if (!destinationHasOccasions()) return '';
  const venues = destinationVenues();
  const buttons = OCCASION_OPTIONS.flatMap(([value, label]) => {
    const active = state.occasionFilters.includes(value);
    // Faceted counts: what the list becomes with this occasion in the mix.
    const withThis = active ? state.occasionFilters : [...state.occasionFilters, value];
    const count = venues.filter((venue) => withThis.every((occasion) => venueOccasions(venue).includes(occasion))).length;
    // An occasion with nothing behind it is hidden entirely — except while
    // selected, so it can still be deselected.
    if (!active && count === 0) return [];
    return `<button type="button" class="occasion-option${active ? ' occasion-option-active' : ''}" data-occasion="${esc(value)}" aria-pressed="${active}" aria-label="${esc(label)}, ${count} ${count === 1 ? 'place' : 'places'}">
      <span>${esc(label)}</span><small aria-hidden="true">${count}</small>
    </button>`;
  }).join('');
  return `<section class="occasion-browser" aria-labelledby="occasion-browser-title" aria-describedby="occasion-browser-help">
    <p class="occasion-browser-copy">
      <span id="occasion-browser-title" class="occasion-browser-label">What kind of stop is this?</span>
      <span id="occasion-browser-help">Combine as many as you want.</span>
    </p>
    <div class="occasion-options" role="group" aria-label="Browse ${esc(destinationLabel() || 'the selection')} by occasion">
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

/**
 * One control bar for the destination: how to browse, where you are, how many
 * places are left after filtering, and the occasion filters themselves.
 */
function discoveryBar(list: Venue[], hasMap: boolean, mapView: boolean): string {
  return `<section class="discovery" aria-label="Explore the selection">
    <div class="discovery-row">
      ${cityViewSwitch(hasMap)}
      ${
        mapView
          ? `<button type="button" class="nearby-btn" data-geolocate ${state.geoBusy ? 'disabled' : ''}>
              ${state.geoBusy ? 'Finding you…' : 'Show nearby'}
            </button>`
          : ''
      }
      <span class="count" aria-live="polite">${list.length} ${list.length === 1 ? 'place' : 'places'}</span>
    </div>
    ${occasionBrowser()}
    ${refineChips()}
    ${state.geoStatus ? `<p class="geo-status" role="status">${esc(state.geoStatus)}</p>` : ''}
  </section>`;
}

function recommendationLoadStatus(city: string): string {
  const notesState = networkPlaceNotesState(city);
  if (notesState.status === 'idle' || notesState.status === 'loading') {
    return `<p class="trusted-list-status" role="status"><span class="network-loading-mark" aria-hidden="true"></span>Loading member notes…</p>`;
  }
  if (notesState.status === 'error') {
    return `<div class="trusted-list-status trusted-list-status-error" role="status">
      <p>${esc(notesState.error || 'Member notes are unavailable right now. The published places are still here.')}</p>
      <button type="button" data-city-notes-retry>Try member notes again</button>
    </div>`;
  }
  return '';
}

/**
 * List or map — the two ways to read a destination. The list leads (a
 * recommendation is a note from a member, not a coordinate) and the map is one
 * click away for anyone planning a route. Destinations with no verified
 * position for any place never offer the map.
 */
function cityViewSwitch(hasMap: boolean): string {
  if (!hasMap) return '';
  const tab = (view: CityView, label: string) =>
    `<button type="button" class="city-view-tab${state.cityView === view ? ' is-active' : ''}"
      data-city-view="${view}" aria-pressed="${state.cityView === view}">${label}</button>`;
  return `<div class="city-view-switch" role="group" aria-label="Browse this destination as a list or a map">
    ${tab('list', 'List')}${tab('map', 'Map')}
  </div>`;
}

function cityListStage(destination: Destination, list: Venue[], emptyState: string): string {
  const shortList = isShortListDestination(destination);
  // No heading: the hero already says whose list this is and how long it is.
  return `<section class="trusted-list" aria-label="${esc(`Places members recommend in ${destination.name}`)}">
    ${recommendationLoadStatus(destination.name)}
    <div class="results trusted-list-results" id="selection-results" tabindex="-1">
      ${
        list.length
          ? shortList
            ? `<ul class="card-list trusted-card-list network-recommendation-grid">${list.map((venue) => venueCard(venue, true)).join('')}</ul>`
            : `<ul class="card-list">${list.map((venue) => venueCard(venue)).join('')}</ul>`
          : emptyState
      }
    </div>
  </section>`;
}

// Cover URLs that failed to load this session; those venues render the
// monogram placeholder directly instead of retrying a dead image every render.
const failedCoverUrls = new Set<string>();

type CoverVariant = 'card' | 'detail' | 'place';

function coverInitial(v: Venue): string {
  return (v.name.trim().charAt(0) || '•').toUpperCase();
}

/**
 * Editorial cover shared by place cards, the map preview and the place page.
 * Blank or failed URLs use the same serif monogram treatment so no surface
 * exposes a broken image or changes silhouette. Card covers are decorative; the
 * detail and place covers carry a concise accessible label in both image and
 * fallback states.
 */
function venueCover(v: Venue, variant: CoverVariant = 'card'): string {
  const image = safeExternalHref(v.imageUrl);
  const usable = image && !failedCoverUrls.has(image);
  const initial = coverInitial(v);
  const baseClass = `${variant}-cover`;
  const placeholderClass = usable ? '' : ` cover-placeholder ${baseClass}-placeholder`;
  const accessibility = variant === 'card'
    ? 'aria-hidden="true"'
    : `role="img" aria-label="${esc(usable ? `Cover photo for ${v.name}` : `Cover photo unavailable for ${v.name}`)}" data-cover-fallback-label="${esc(`Cover photo unavailable for ${v.name}`)}"`;

  return `<figure class="${baseClass}${placeholderClass}" data-cover-initial="${esc(initial)}" ${accessibility}>${
    usable
      ? `<img src="${esc(image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-cover-image>`
      : `<span aria-hidden="true">${esc(initial)}</span>`
  }</figure>`;
}

function showCoverFallback(img: HTMLImageElement): void {
  failedCoverUrls.add(img.currentSrc || img.src);
  const figure = img.closest<HTMLElement>('.card-cover, .detail-cover, .place-cover, .network-entry-thumb');
  if (!figure || figure.classList.contains('cover-placeholder')) return;
  const baseClass = figure.classList.contains('detail-cover')
    ? 'detail-cover'
    : figure.classList.contains('place-cover')
      ? 'place-cover'
      : figure.classList.contains('network-entry-thumb')
        ? 'network-entry-thumb'
        : 'card-cover';
  figure.classList.add('cover-placeholder', `${baseClass}-placeholder`);
  figure.textContent = '';
  if (baseClass === 'detail-cover' || baseClass === 'place-cover') {
    figure.setAttribute('role', 'img');
    figure.setAttribute('aria-label', figure.dataset.coverFallbackLabel || 'Cover photo unavailable');
  }
  const initial = document.createElement('span');
  initial.setAttribute('aria-hidden', 'true');
  initial.textContent = figure.dataset.coverInitial || '•';
  figure.append(initial);
}

function recommendationNotesForVenue(v: Venue) {
  const scope = activeDestination()?.name || '';
  const name = normalizePlacePart(v.name);
  const city = normalizePlacePart(v.city);
  return networkPlaceNotes(scope).filter((item) => {
    const note = item.note?.trim();
    const recommender = item.recommender_pseudo?.trim().replace(/^@+/, '');
    if (!note || (!item.is_own && !recommender)) return false;
    if (item.venue_id) return item.venue_id === v.id;
    if (normalizePlacePart(item.venue_name || '') !== name) return false;
    const itemCity = normalizePlacePart(item.city || '');
    return !itemCity || !city || itemCity === city;
  });
}

function recommendationAttribution(item: ReturnType<typeof recommendationNotesForVenue>[number]): string {
  const recommender = item.recommender_pseudo?.trim().replace(/^@+/, '');
  const label = item.is_own ? 'You' : recommender ? `@${recommender}` : '';
  if (!label || !item.note?.trim()) return '';
  return `<blockquote class="card-member-note">
    <p>${esc(item.note)}</p>
    <footer>Recommended by <strong class="network-pseudo">${esc(label)}</strong></footer>
  </blockquote>`;
}

/**
 * Short-list card — the landing page's recommendation cassette, so a place
 * reads the same wherever a member recommended it: cover, display title, the
 * member's note, the byline, the barcode strip. The title links to the place's
 * own page, where practical detail (address, directions, occasions, every
 * member note) lives rather than being repeated here.
 */
function trustedVenueCard(v: Venue): string {
  const selected = v.id === state.selectedId;
  const initial = coverInitial(v);
  const image = safeExternalHref(v.imageUrl);
  const usable = image && !failedCoverUrls.has(image);
  const thumb = `<figure class="network-entry-thumb${usable ? '' : ' cover-placeholder network-entry-thumb-placeholder'}" data-cover-initial="${esc(initial)}" aria-hidden="true">${
    usable
      ? `<img src="${esc(image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-cover-image>`
      : `<span aria-hidden="true">${esc(initial)}</span>`
  }</figure>`;
  const meta = [v.category, v.neighborhood, hasDistinctLocality(v) ? v.city : '']
    .filter(Boolean)
    .join(' · ');
  const notes = recommendationNotesForVenue(v)
    .map((item) => {
      const recommender = item.recommender_pseudo?.trim().replace(/^@+/, '');
      const label = item.is_own ? 'You' : recommender ? `@${recommender}` : '';
      if (!label || !item.note?.trim()) return '';
      return `<blockquote><p>${esc(item.note)}</p></blockquote>
        <p class="network-entry-byline">Recommended by <strong class="network-pseudo">${esc(label)}</strong></p>`;
    })
    .filter(Boolean)
    .join('');
  return `<li>
    <article class="network-entry network-recommendation network-entry-with-thumb trusted-entry${selected ? ' is-selected' : ''}">
      <div class="network-entry-main">
        <header class="network-entry-head">
          <div>
            <h3><a class="network-entry-place" href="${esc(placeHref(v))}" data-place="${esc(v.id)}" aria-current="${selected ? 'page' : 'false'}">${esc(v.name)}</a></h3>
            ${meta ? `<p class="network-place-meta">${esc(meta)}</p>` : ''}
          </div>
          ${venueSignalBadge(v)}
        </header>
        ${notes || '<p class="network-entry-note-empty">No note was included with this recommendation.</p>'}
      </div>
      ${thumb}
    </article>
  </li>`;
}

function venueCard(v: Venue, trustedList = false): string {
  if (trustedList) return trustedVenueCard(v);
  const selected = v.id === state.selectedId;
  const distinctLocality = hasDistinctLocality(v);
  const recommendations = recommendationNotesForVenue(v)
    .map(recommendationAttribution)
    .filter(Boolean)
    .join('');
  return `<li>
    <article class="card card-detourist${selected ? ' card-selected' : ''}">
      <a class="card-main" href="${esc(placeHref(v))}" data-place="${esc(v.id)}" aria-current="${selected ? 'page' : 'false'}">
        ${venueCover(v)}
        <span class="card-place-copy">
          <h3>${esc(v.name)}</h3>
          <p class="card-meta">${esc([v.category, v.neighborhood].filter(Boolean).join(' · '))}</p>
          ${distinctLocality ? `<p class="card-locality"><span>${esc(v.city)}</span><small>${esc(venueRouteName(v))} selection</small></p>` : ''}
          <p class="card-address">${
            v.address
              ? esc(v.address)
              : '<span class="approx">Map position being refined</span>'
          }</p>
          ${venueOccasions(v).length ? `<span class="card-occasions" aria-label="Good for ${esc(occasionSummary(v))}"><span class="card-occasions-label">Good for</span>${venueOccasions(v).map((occasion) => `<span>${esc(occasionLabel(occasion))}</span>`).join('')}</span>` : ''}
        </span>
      </a>
      ${venueSignalBadge(v)}
      ${recommendations ? `<div class="card-member-notes" aria-label="Member recommendation notes">${recommendations}</div>` : ''}
    </article>
  </li>`;
}

function shortDate(value: string | undefined): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(parsed);
}

/** Operator and social links for one place; '' when the record carries none. */
function venueVisitLinks(v: Venue): string {
  const officialUrl = safeExternalHref(v.officialUrl);
  const instagramUrl = safeExternalHref(v.instagramUrl);
  return [
    officialUrl
      ? `<a href="${esc(officialUrl)}" target="_blank" rel="noopener noreferrer">Official website <span class="nav-arrow" aria-hidden="true">↗</span></a>`
      : '',
    instagramUrl
      ? `<a href="${esc(instagramUrl)}" target="_blank" rel="noopener noreferrer">Instagram <span class="nav-arrow" aria-hidden="true">↗</span></a>`
      : '',
  ]
    .filter(Boolean)
    .join('');
}

/**
 * Map-view pin preview. Cards no longer open this — they lead to the place's
 * own page — so the panel exists only to answer "which pin did I just click",
 * and every full answer is one link away.
 */
function detailPanel(): string {
  const v = destinationVenues().find((x) => x.id === state.selectedId);
  if (!v) {
    return `<p class="map-prompt" aria-live="polite">Choose a pin to see the place — or switch to the list to read what members wrote.</p>`;
  }
  const distinctLocality = hasDistinctLocality(v);
  const detailMeta = [v.category, v.neighborhood, distinctLocality ? v.city : '']
    .filter(Boolean)
    .join(' · ');
  const directions = directionsHref(v);
  return `<aside class="detail" id="selected-place-detail" aria-live="polite" aria-label="Selected place">
    <div class="detail-head">
      <div>
        <p class="detail-overline">Selected place</p>
        <h2>${esc(v.name)}</h2>
        ${detailMeta ? `<p class="detail-meta">${esc(detailMeta)}</p>` : ''}
      </div>
      <div class="detail-head-side">
        ${venueSignalBadge(v)}
        <button type="button" class="detail-close" data-close aria-label="Close details"><span aria-hidden="true">×</span></button>
      </div>
    </div>
    <div class="detail-body">
      <div class="detail-practical">
        <p class="detail-locator-address">${
          v.address ? esc(v.address) : '<span class="approx">Map position being refined</span>'
        }</p>
        ${v.approxLocation && v.lat !== null ? '<p class="approx">Position is approximate — confirm before you set off.</p>' : ''}
        ${
          venueOccasions(v).length
            ? `<p class="detail-locator-occasions"><span>Good for</span> ${esc(venueOccasions(v).map(occasionLabel).join(' · '))}</p>`
            : ''
        }
        <div class="detail-visit-links">
          <a class="detail-open-place" href="${esc(placeHref(v))}" data-place="${esc(v.id)}" aria-label="Open the full place page for ${esc(v.name)}">To full page <span class="nav-arrow" aria-hidden="true">→</span></a>
          ${directions ? `<a href="${esc(directions)}" target="_blank" rel="noopener noreferrer">Get directions <span class="nav-arrow" aria-hidden="true">↗</span></a>` : ''}
          ${venueVisitLinks(v)}
        </div>
      </div>
    </div>
  </aside>`;
}

/* ---------- place page ---------- */

/**
 * One place, one page. The markup lives in place.ts; this wires it to the
 * app's routing, chrome and shared venue formatting, then mounts the locator.
 */
function renderPlace(root: HTMLElement, destination: Destination, v: Venue): void {
  destroyMap();
  root.dataset.restyle = 'place';
  applyTapeTheme();
  syncDocumentMeta(destination.name, false, v);

  const country = destinationCountry(destination);
  const chrome: PlaceChrome = {
    destinationName: destination.name,
    destinationSlug: destination.slug,
    destinationHref: destinationHref(destination.slug),
    countryName: destination.country,
    countrySlug: country?.slug ?? '',
    countryHref: country ? countryHref(country.slug) : exploreHref(),
    exploreHref: exploreHref(),
    canExplore: memberCanExplore(),
    homeHref: homeHref(),
    accountHref: accountHref(),
    brandMark: brandMark(),
    communityControl: communityControl(accountHref()),
    footerTagline: FOOTER_TAGLINE,
    themeToggle: tapeThemeToggleMarkup(),
  };
  const helpers: PlaceHelpers = {
    esc,
    safeExternalHref,
    cover: (venue) => venueCover(venue, 'place'),
    visitLinks: venueVisitLinks,
    directionsHref,
    occasionLabels: (venue) => venueOccasions(venue).map(occasionLabel),
    hasDistinctLocality,
    routeName: venueRouteName,
    notes: recommendationNotesForVenue,
    notesStatus: recommendationLoadStatus(destination.name),
    shortDate,
  };

  root.innerHTML = placePageMarkup(v, chrome, helpers);

  bindRouteLinks(root);
  // Member notes render here, so a direct place link has to load the circle
  // feed itself rather than relying on the destination view having done it.
  ensureNetworkDiscovery(() => render(root), destination.name);
  root.querySelector<HTMLButtonElement>('[data-city-notes-retry]')?.addEventListener('click', () => {
    pendingFocus = '[data-city-notes-retry]';
    retryNetworkPlaceNotes(() => render(root), destination.name);
  });
  root.querySelectorAll<HTMLImageElement>('[data-cover-image]').forEach((img) => {
    img.addEventListener('error', () => showCoverFallback(img), { once: true });
    if (img.complete && img.naturalWidth === 0) showCoverFallback(img);
  });
  if (placeIsLocated(v)) mountLocatorMap(root, v);
  else destroyLocatorMap();
  if (pendingFocus) {
    const target = root.querySelector<HTMLElement>(pendingFocus);
    pendingFocus = null;
    target?.focus({ preventScroll: true });
  }
}

/* ---------- render ---------- */

/**
 * Keep the browser tab title and description in step with the current route.
 * A place page names the place itself, so a shared link previews as that place
 * rather than as the destination it sits in.
 */
function syncDocumentMeta(destinationName: string | null, account = false, place: Venue | null = null): void {
  document.title = account
    ? 'Members — Detour'
    : place
      ? `${place.name}, ${place.city} — Detour`
      : destinationName
        ? `Detour — Member-recommended places in ${destinationName}`
        : GLOBAL_META_TITLE;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (meta) {
    meta.setAttribute(
      'content',
      account
        ? 'Sign in to Detour membership to manage invitations, recommend places, and exchange private place shares.'
        : place
          ? `${place.name} in ${place.city}${place.category ? ` — ${place.category}` : ''}: why Detour members recommend it, what they wrote about it, where it is, and how to get there.`
          : destinationName
            ? destinationHasOccasions()
              ? `Browse member-recommended Detourist List places in ${destinationName} by occasion, from celebrations to quick local stops.`
              : `Explore member-recommended Detourist List places in ${destinationName}, with practical details and a map for planning your next detour.`
            : GLOBAL_META_DESCRIPTION
    );
  }
}

/** Close any open masthead member menu; document-level so it survives re-renders. */
function closeMemberMenu(focusToggle = false): void {
  document.querySelectorAll<HTMLElement>('[data-community-menu]').forEach((menu) => {
    const toggle = menu.querySelector<HTMLButtonElement>('[data-community-menu-toggle]');
    const items = menu.querySelector<HTMLElement>('.community-menu-items');
    if (!toggle || !items || toggle.getAttribute('aria-expanded') !== 'true') return;
    toggle.setAttribute('aria-expanded', 'false');
    items.hidden = true;
    menu.classList.remove('is-open');
    if (focusToggle) toggle.focus({ preventScroll: true });
  });
}

function bindMemberMenu(root: HTMLElement): void {
  // Dismissal is bound to the document once per session: every menu action
  // re-renders the view, so per-render listeners here would accumulate.
  if (!memberMenuDismissBound) {
    memberMenuDismissBound = true;
    // Capture phase: map pins stop propagation on click, so a bubble-phase
    // listener would miss those and leave the menu open.
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target;
        if (target instanceof Element && target.closest('[data-community-menu]')) return;
        closeMemberMenu();
      },
      true
    );
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeMemberMenu(true);
    });
  }

  const menu = root.querySelector<HTMLElement>('[data-community-menu]');
  const toggle = menu?.querySelector<HTMLButtonElement>('[data-community-menu-toggle]');
  const items = menu?.querySelector<HTMLElement>('.community-menu-items');
  if (!menu || !toggle || !items) return;
  const entries = Array.from(items.querySelectorAll<HTMLElement>('[role="menuitem"]'));

  const openMenu = (focusFirst: boolean) => {
    toggle.setAttribute('aria-expanded', 'true');
    items.hidden = false;
    menu.classList.add('is-open');
    if (focusFirst) entries[0]?.focus({ preventScroll: true });
  };

  toggle.addEventListener('click', () => {
    if (toggle.getAttribute('aria-expanded') === 'true') closeMemberMenu();
    else openMenu(false);
  });
  toggle.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    openMenu(true);
  });
  entries.forEach((entry) => {
    entry.addEventListener('keydown', (event) => {
      const currentIndex = entries.indexOf(entry);
      let nextIndex = currentIndex;
      if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % entries.length;
      else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + entries.length) % entries.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = entries.length - 1;
      else return;
      event.preventDefault();
      entries[nextIndex]?.focus({ preventScroll: true });
    });
  });
}

function bindRouteLinks(root: HTMLElement): void {
  // Theme switching is pure CSS on a root attribute — update in place, no
  // re-render needed. Bound here because every view calls bindRouteLinks.
  root.querySelector<HTMLButtonElement>('[data-tape-theme-toggle]')?.addEventListener('click', (event) => {
    tapeTheme = tapeTheme === 'auto' ? 'light' : tapeTheme === 'light' ? 'dark' : 'auto';
    localStorage.setItem(TAPE_THEME_KEY, tapeTheme);
    applyTapeTheme();
    (event.currentTarget as HTMLButtonElement).textContent = tapeThemeLabel();
  });
  bindMemberMenu(root);
  root.querySelectorAll<HTMLButtonElement>('[data-community-sign-out]').forEach((button) => {
    button.addEventListener('click', () => {
      signOutMember();
      render(root);
    });
  });
  root.querySelectorAll<HTMLAnchorElement>('[data-community-route]').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const target = link.getAttribute('data-community-route');
      const preset = target === 'share-place' ? openSharePlace : target === 'recommend-place' ? openRecommendPlace : null;
      preset?.();
      // Menu entries name the member-area tab they open.
      const openedTab = !preset && target ? openMemberArea(target) : false;
      if (state.view !== 'account') showAccount(root);
      else if (preset || openedTab) render(root);
    });
  });
  root.querySelectorAll<HTMLAnchorElement>('[data-return-discovery]').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      returnToDiscovery(root);
    });
  });
  // Every place link in the app — feed cards, list cards, the map preview, the
  // member area — routes through here, so a place always opens as its own page.
  // Real anchors carry the canonical href, so modified clicks open a new tab.
  root.querySelectorAll<HTMLElement>('[data-place]').forEach((el) => {
    el.addEventListener('click', (event) => {
      if (event instanceof MouseEvent && (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
      const id = el.dataset.place ?? '';
      const venue = allVenues().find((v) => v.id === id);
      if (!venue) return;
      event.preventDefault();
      openPlace(root, venue);
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
  root.querySelectorAll<HTMLAnchorElement>('[data-explore]').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      showExplore(root);
    });
  });
  root.querySelectorAll<HTMLAnchorElement>('[data-country]').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const slug = link.dataset.country?.trim().toLowerCase() ?? '';
      if (!slug) return;
      event.preventDefault();
      showCountry(root, slug);
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

async function refreshCatalogue(): Promise<Venue[]> {
  const { venues } = await loadLiveCatalogue();
  state.mode = 'live';
  state.venues = venues;
  return venues;
}

function renderAccount(root: HTMLElement): void {
  destroyMap();
  syncDocumentMeta(null, true);
  root.innerHTML = `
    <a class="skip-link" href="#community-area">Skip to member area</a>
    <header class="account-masthead">
      <div class="account-nav-row">
        <a class="account-brand" href="${esc(homeHref())}" data-return-discovery>${brandMark()}Detour</a>
        <nav class="account-nav" aria-label="Member navigation">
          ${memberCanExplore() ? `<a class="network-explore-link" href="${esc(exploreHref())}" data-explore>Explore</a>` : ''}
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
      <p>${FOOTER_TAGLINE}</p>
      ${tapeThemeToggleMarkup()}
    </footer>
  `;

  bindCommunity(root, state.venues, () => render(root), () => showHome(root), markFirstPlaceContributed, refreshCatalogue);
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
 * place names, and the typed 'Place — Locality' form. Physical-locality
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

function mastheadMarkup(active: 'home' | 'explore' | 'other' = 'other'): string {
  const brand =
    active === 'home'
      ? `<p class="network-brand">${brandMark()}Detour</p>`
      : `<a class="network-brand" href="${esc(homeHref())}" data-home>${brandMark()}Detour</a>`;
  return `<header class="network-masthead">
    ${brand}
    <nav class="network-primary-nav" aria-label="Primary navigation">
      ${
        memberCanExplore()
          ? `<a class="network-explore-link${active === 'explore' ? ' is-current' : ''}" href="${esc(exploreHref())}" data-explore${
              active === 'explore' ? ' aria-current="page"' : ''
            }>Explore</a>`
          : ''
      }
      ${communityControl(accountHref())}
    </nav>
  </header>`;
}

function memberCanExplore(): boolean {
  return pb.authStore.isValid && Boolean(pb.authStore.record);
}

function exploreSearchOptions(): string {
  if (state.mode !== 'live') return '';
  const values = new Set<string>();
  for (const destination of destinations()) {
    values.add(destination.country ? `${destination.name}, ${destination.country}` : destination.name);
  }
  for (const venue of allVenues()) {
    if (hasDistinctLocality(venue)) {
      values.add(venue.country ? `${venue.city}, ${venue.country}` : venue.city);
    }
    values.add(`${venue.name} — ${venue.city}`);
  }
  return [...values]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => `<option value="${esc(value)}"></option>`)
    .join('');
}

function exploreSearchMarkup(): string {
  const disabled = state.mode !== 'live';
  const catalogueStatus =
    state.mode === 'loading'
      ? '<p class="network-search-status loading" role="status">Preparing destination search…</p>'
      : state.mode === 'error'
        ? '<p class="network-search-status is-error" role="status">Destination search is unavailable right now.</p>'
        : destinations().length === 0
          ? '<p class="network-search-status" role="status">There are no published destinations at the moment.</p>'
          : '';
  const noResult = state.exploreQuery
    ? `<div class="explore-no-result" role="status" tabindex="-1">
        <p><strong>No published city or place matches “${esc(state.exploreQuery)}.”</strong> Detour grows wherever members recommend something worth the trip.</p>
        <a href="${esc(accountHref())}" data-community-route="recommend-place">Recommend a place <span class="nav-arrow" aria-hidden="true">↗</span></a>
      </div>`
    : '';
  return `<form class="destination-search explore-search" data-explore-search role="search" aria-label="Search cities and places">
      <label for="explore-search-input">Search cities and places</label>
      <div class="network-search-controls">
        <input id="explore-search-input" name="query" type="search" list="explore-search-options"
          value="${esc(state.exploreQuery)}" autocomplete="off" spellcheck="false"
          placeholder="Madrid, Tartine…" ${disabled ? 'disabled' : ''}>
        <datalist id="explore-search-options">${exploreSearchOptions()}</datalist>
        <button class="destination-go" type="submit" ${disabled ? 'disabled' : ''}>Search</button>
        <button class="destination-near" type="button" data-geolocate ${
          state.geoBusy || disabled ? 'disabled' : ''
        }>${state.geoBusy ? 'Finding you…' : 'Use my location'}</button>
      </div>
      ${catalogueStatus}
      ${state.geoStatus ? `<p class="geo-status" role="status">${esc(state.geoStatus)}</p>` : ''}
      ${noResult}
    </form>`;
}

function destinationDirectoryCard(destination: Destination): string {
  const memberSignal =
    destination.recommendationCount === 1
      ? '1 member recommendation'
      : `${destination.recommendationCount} member recommendations`;
  return `<a class="explore-destination-card" href="${esc(destinationHref(destination.slug))}"
      data-open-destination="${esc(destination.slug)}">
      <span class="explore-destination-name">${esc(destination.name)}</span>
      <span class="explore-destination-meta">${destination.count} ${
        destination.count === 1 ? 'place' : 'places'
      } · ${memberSignal}</span>
      <span class="explore-destination-arrow nav-arrow" aria-hidden="true">→</span>
    </a>`;
}

function bindExploreDiscovery(root: HTMLElement): void {
  root.querySelector<HTMLFormElement>('[data-explore-search]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = root.querySelector<HTMLInputElement>('#explore-search-input');
    const query = input?.value.trim() ?? '';
    const resolved = resolveSearch(query);
    if (resolved) {
      state.exploreQuery = '';
      state.geoStatus = '';
      const venue = resolved.venueId ? allVenues().find((item) => item.id === resolved.venueId) : undefined;
      if (venue) openPlace(root, venue);
      else openDestination(root, resolved.slug);
      return;
    }
    state.exploreQuery = query;
    pendingFocus = query ? '.explore-no-result' : '#explore-search-input';
    render(root);
  });
  root.querySelector<HTMLInputElement>('#explore-search-input')?.addEventListener('input', (event) => {
    if (state.exploreQuery && (event.currentTarget as HTMLInputElement).value.trim() !== state.exploreQuery) {
      state.exploreQuery = '';
      root.querySelector('.explore-no-result')?.remove();
    }
  });
  root.querySelector<HTMLButtonElement>('[data-geolocate]')?.addEventListener('click', () => {
    state.exploreQuery = '';
    requestNearestDestination(root);
  });
}

function renderExplore(root: HTMLElement): void {
  destroyMap();
  root.dataset.restyle = 'explore';
  applyTapeTheme();
  document.title = 'Explore cities and places — Detour';
  document
    .querySelector<HTMLMetaElement>('meta[name="description"]')
    ?.setAttribute(
      'content',
      'Explore every city and food-and-drink destination published on Detour, grouped by country and shaped by member recommendations.'
    );

  const countries = destinationCountries();
  const featured = [...destinations()]
    .sort(
      (a, b) =>
        b.recommendationCount - a.recommendationCount ||
        b.count - a.count ||
        a.name.localeCompare(b.name)
    )
    .slice(0, 3);
  const directory = countries
    .map(
      (country) => `<section class="explore-country-group" aria-labelledby="country-${esc(country.slug)}">
        <div class="explore-country-heading">
          <div>
            <p class="explore-country-overline">${country.count} ${country.count === 1 ? 'place' : 'places'}</p>
            <h2 id="country-${esc(country.slug)}">${esc(country.name)}</h2>
          </div>
          <a href="${esc(countryHref(country.slug))}" data-country="${esc(country.slug)}">Open country <span class="nav-arrow" aria-hidden="true">→</span></a>
        </div>
        <div class="explore-destination-grid">${country.destinations.map(destinationDirectoryCard).join('')}</div>
      </section>`
    )
    .join('');

  root.innerHTML = `
    <a class="skip-link" href="#explore-title">Skip to Explore</a>
    ${mastheadMarkup('explore')}
    <main class="explore-page">
      <header class="explore-hero">
        <p class="network-kicker">The full Detour directory</p>
        <h1 id="explore-title" tabindex="-1">Find your next city.</h1>
        <p>Search a place directly, browse every covered city by country, or start with the destinations members recommend most.</p>
        ${exploreSearchMarkup()}
      </header>
      ${
        featured.length
          ? `<section class="explore-featured" aria-labelledby="explore-featured-title">
              <div class="explore-section-heading">
                <p>Start here</p>
                <h2 id="explore-featured-title">Most recommended cities</h2>
              </div>
              <div class="explore-featured-grid">${featured.map(destinationDirectoryCard).join('')}</div>
            </section>`
          : ''
      }
      <section class="explore-directory" aria-labelledby="explore-directory-title">
        <div class="explore-section-heading">
          <p>${countries.length} ${countries.length === 1 ? 'country' : 'countries'}</p>
          <h2 id="explore-directory-title">All destinations</h2>
        </div>
        ${directory || '<p class="explore-empty">No destinations have been published yet.</p>'}
      </section>
    </main>
    <footer class="footer explore-footer">
      <p>${FOOTER_TAGLINE}</p>
      ${tapeThemeToggleMarkup()}
    </footer>
  `;
  bindRouteLinks(root);
  bindExploreDiscovery(root);
  if (pendingFocus) {
    const target = root.querySelector<HTMLElement>(pendingFocus);
    pendingFocus = null;
    target?.focus({ preventScroll: true });
  }
}

function renderCountry(root: HTMLElement): void {
  const country = destinationCountryBySlug(state.country);
  if (!country) {
    state.view = memberCanExplore() ? 'explore' : 'home';
    state.country = null;
    updateRoute(state.view, null, 'replace');
    state.exploreQuery = '';
    if (memberCanExplore()) renderExplore(root);
    else renderHome(root);
    return;
  }
  if (!memberCanExplore()) {
    renderDiscoveryGate(
      root,
      'country-title',
      country.name,
      `Explore ${country.name} with the circle.`,
      `Sign in or join Detour to browse ${country.destinations.length === 1 ? 'its city' : 'its cities'} and member-recommended places.`
    );
    return;
  }
  destroyMap();
  root.dataset.restyle = 'explore';
  applyTapeTheme();
  document.title = `${country.name} destinations — Detour`;
  document
    .querySelector<HTMLMetaElement>('meta[name="description"]')
    ?.setAttribute(
      'content',
      `Explore member-recommended food-and-drink destinations across ${country.name} on Detour.`
    );
  root.innerHTML = `
    <a class="skip-link" href="#country-title">Skip to ${esc(country.name)}</a>
    ${mastheadMarkup('explore')}
    <main class="explore-page country-page">
      <nav class="explore-breadcrumb" aria-label="Breadcrumb">
        <a href="${esc(exploreHref())}" data-explore>Explore</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">${esc(country.name)}</span>
      </nav>
      <header class="explore-hero country-hero">
        <p class="network-kicker">${country.destinations.length} ${
          country.destinations.length === 1 ? 'city' : 'cities'
        }</p>
        <h1 id="country-title" tabindex="-1">${esc(country.name)}, city by city.</h1>
      </header>
      <section class="explore-directory country-directory" aria-label="${esc(country.name)} destinations">
        <div class="explore-destination-grid">${country.destinations.map(destinationDirectoryCard).join('')}</div>
      </section>
    </main>
    <footer class="footer explore-footer">
      <p>${FOOTER_TAGLINE}</p>
      ${tapeThemeToggleMarkup()}
    </footer>
  `;
  bindRouteLinks(root);
  if (pendingFocus) {
    const target = root.querySelector<HTMLElement>(pendingFocus);
    pendingFocus = null;
    target?.focus({ preventScroll: true });
  }
}

function renderDiscoveryGate(
  root: HTMLElement,
  titleId: string,
  label: string,
  title: string,
  copy: string
): void {
  destroyMap();
  root.dataset.restyle = 'destination';
  applyTapeTheme();
  document.title = `${label} — Members — Detour`;
  document
    .querySelector<HTMLMetaElement>('meta[name="description"]')
    ?.setAttribute('content', `Join Detour to explore member-recommended food-and-drink destinations in ${label}.`);
  root.innerHTML = `
    <a class="skip-link" href="#${esc(titleId)}">Skip to membership</a>
    ${mastheadMarkup()}
    <nav class="explore-breadcrumb destination-breadcrumb" aria-label="Breadcrumb">
      <a href="${esc(homeHref())}" data-home>Home</a>
      <span aria-hidden="true">/</span>
      <span aria-current="page">${esc(label)}</span>
    </nav>
    <div class="hero city-detail-hero discovery-gate-hero">
      <div class="hero-inner">
        <p class="network-kicker">Member discovery</p>
        <h1 id="${esc(titleId)}" tabindex="-1">${esc(title)}</h1>
        <p class="tagline">${esc(copy)}</p>
      </div>
    </div>
    <section class="city-chooser discovery-gate" aria-label="Join Detour">
      <div class="city-chooser-heading">
        <h2>Continue with Detour</h2>
        <p>Membership keeps the full city and country directories inside the circle.</p>
      </div>
      <a class="network-primary-link" href="${esc(accountHref())}" data-community-route>
        Sign in or join <span class="nav-arrow" aria-hidden="true">↗</span>
      </a>
    </section>
    <footer class="footer">
      <p>${FOOTER_TAGLINE}</p>
      ${tapeThemeToggleMarkup()}
    </footer>
  `;
  bindRouteLinks(root);
  if (pendingFocus) {
    const target = root.querySelector<HTMLElement>(pendingFocus);
    pendingFocus = null;
    target?.focus({ preventScroll: true });
  }
}

/**
 * Mirrors the backend's normalizePlacePart so feed entries match published
 * venues by the same place identity the waitlist publication uses.
 */
function normalizePlacePart(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[\u2010-\u2015]/g, ' ')
    .replace(/[.,/#!$%^*;:{}=\-_~()\[\]"?<>\\|+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Matches a recommended place to a published venue, or null when it has none. */
function resolveNetworkPlace(
  venueName: string,
  city: string
): { venueId: string; destinationSlug: string; destinationHref: string; placeHref: string; imageUrl?: string } | null {
  if (state.mode !== 'live') return null;
  const name = normalizePlacePart(venueName);
  if (!name) return null;
  const matches = allVenues().filter((v) => normalizePlacePart(v.name) === name);
  if (matches.length === 0) return null;
  const normCity = normalizePlacePart(city);
  const match = normCity
    ? matches.find((v) => normalizePlacePart(v.city) === normCity)
    : matches.length === 1
      ? matches[0]
      : undefined;
  if (!match) return null;
  const image = safeExternalHref(match.imageUrl);
  return {
    venueId: match.id,
    destinationSlug: venueRouteSlug(match),
    destinationHref: destinationHref(venueRouteSlug(match)),
    placeHref: placeHref(match),
    imageUrl: image && !failedCoverUrls.has(image) ? image : undefined,
  };
}

// Manual override for the mixtape light/dark tokens; 'auto' follows the OS
// via the prefers-color-scheme block in styles.css.
type TapeTheme = 'auto' | 'light' | 'dark';
const TAPE_THEME_KEY = 'detour-tape-theme';
let tapeTheme: TapeTheme = ((): TapeTheme => {
  const stored = localStorage.getItem(TAPE_THEME_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'auto';
})();

// The tokens live on :root so the page (not just #app) is themed — the
// overscroll gutter behind the fixed ground would otherwise stay one colour.
function applyTapeTheme(): void {
  const html = document.documentElement;
  if (tapeTheme === 'auto') delete html.dataset.tapeTheme;
  else html.dataset.tapeTheme = tapeTheme;
}

function tapeThemeLabel(): string {
  return `Theme: ${tapeTheme}`;
}

function tapeThemeToggleMarkup(): string {
  return `<button type="button" class="tape-theme-toggle" data-tape-theme-toggle aria-label="Switch color theme (auto, light, dark)">${tapeThemeLabel()}</button>`;
}

// Fixed sign-off, identical on every view. Kept as one constant so the pages
// cannot drift back into writing their own wording.
const FOOTER_TAGLINE = 'Recommended by members. Ready for your next detour.';

function renderHome(root: HTMLElement): void {
  destroyMap();
  root.dataset.restyle = 'home';
  applyTapeTheme();
  syncDocumentMeta(null);

  root.innerHTML = `
    <a class="skip-link" href="#network-home-title">Skip to circle discovery</a>
    ${mastheadMarkup('home')}
    ${networkDiscoveryMarkup(accountHref(), resolveNetworkPlace)}
    <footer class="footer network-footer">
      <p>${FOOTER_TAGLINE}</p>
      ${tapeThemeToggleMarkup()}
    </footer>
  `;

  bindRouteLinks(root);
  bindNetworkDiscovery(root, () => render(root));
  // A feed thumb that fails to load falls back to the monogram in place, so
  // the card keeps its silhouette instead of collapsing; the URL is remembered
  // so later renders skip it without re-requesting.
  root.querySelectorAll<HTMLImageElement>('[data-network-thumb]').forEach((img) => {
    img.addEventListener('error', () => {
      failedCoverUrls.add(img.currentSrc || img.src);
      const figure = img.closest<HTMLElement>('.network-entry-thumb');
      if (!figure || figure.classList.contains('cover-placeholder')) return;
      figure.classList.add('cover-placeholder', 'network-entry-thumb-placeholder');
      figure.textContent = '';
      const initial = document.createElement('span');
      initial.setAttribute('aria-hidden', 'true');
      initial.textContent = figure.dataset.coverInitial || '•';
      figure.append(initial);
    });
  });
  if (pendingFocus) {
    const target = root.querySelector<HTMLElement>(pendingFocus);
    pendingFocus = null;
    target?.focus({ preventScroll: true });
  }
}

function render(root: HTMLElement) {
  // Mixtape design scope: every view tags itself so styles.css can target
  // views individually; the theme attribute rides along app-wide.
  applyTapeTheme();
  root.dataset.restyle =
    state.view === 'survey'
      ? 'survey'
      : state.view === 'account'
        ? 'account'
        : state.view === 'explore' || state.view === 'country'
          ? 'explore'
        : state.mode === 'loading' || state.view === 'home' || !state.destination
          ? 'home'
          : state.view === 'place'
            ? 'place'
            : 'destination';
  if (state.view === 'survey') {
    destroyMap();
    document.title = 'Founding feedback — Detour';
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    meta?.setAttribute('content', 'Share anonymous founding feedback to help Detour build better place discovery around people whose taste you trust.');
    renderFoundingSurvey(root, { homeHref: homeHref(), brandMark: brandMark() });
    bindRouteLinks(root);
    return;
  }

  if (state.view === 'account') {
    renderAccount(root);
    return;
  }

  if (!memberCanExplore() && state.view === 'explore') {
    state.view = 'home';
    state.country = null;
    state.exploreQuery = '';
    updateRoute('home', null, 'replace');
    renderHome(root);
    return;
  }

  if (state.mode !== 'loading' && state.view === 'explore') {
    renderExplore(root);
    return;
  }

  if (state.mode !== 'loading' && state.view === 'country') {
    renderCountry(root);
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
      <a class="skip-link" href="#destination-title">Skip to destination</a>
      ${mastheadMarkup()}
      <div class="hero city-detail-hero">
        <div class="hero-inner">
          <h1 id="destination-title" tabindex="-1">${esc(name)}, not yet.</h1>
          <p class="tagline">No published places here so far — Detour grows wherever its members eat well.</p>
        </div>
      </div>
      <section class="city-chooser" aria-label="No coverage yet">
        <div class="city-chooser-heading">
          <h2>Be the first</h2>
          <p>A meaningful recommendation from a verified member puts a place on the list. <a href="${esc(accountHref())}" data-community-route>Recommend a place in ${esc(name)} <span class="nav-arrow" aria-hidden="true">↗</span></a></p>
        </div>
        <p class="city-chooser-status"><a href="${esc(exploreHref())}" data-explore><span class="nav-arrow nav-arrow-back" aria-hidden="true">←</span> Back to Explore</a></p>
      </section>
      <footer class="footer city-chooser-footer">
        <p>${FOOTER_TAGLINE}</p>
        ${tapeThemeToggleMarkup()}
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

  // One place, its own page. An unresolvable place slug is not an error the
  // visitor can act on, so it silently settles on the destination it names.
  if (state.view === 'place') {
    const place = activePlace();
    if (place) {
      renderPlace(root, destination, place);
      return;
    }
    state.place = null;
    state.view = 'destination';
    updateRoute('destination', state.destination, 'replace');
  }

  if (!memberCanExplore()) {
    renderDiscoveryGate(
      root,
      'destination-title',
      destination.name,
      `${destination.name} is inside the circle.`,
      `Sign in or join Detour to browse every member-recommended place in ${destination.name}.`
    );
    return;
  }

  syncDocumentMeta(destination.name);
  const list = filteredVenues();
  const hasMap = mappableVenues(destinationVenues()).length > 0;
  const emptyState = `<div class="empty-state" role="status">
      <p class="empty-state-title">Nothing matches yet</p>
      <p class="empty-state-body">Adjust the filters, or start again with all ${esc(destination.name)} places.</p>
      <button type="button" class="empty-state-reset" data-reset-filters>Show everything</button>
    </div>`;
  const occasionBrowsing = destinationHasOccasions();
  const shortList = isShortListDestination(destination);
  const destinationTitle = shortList
    ? `${destination.name}, a few places members stand behind.`
    : occasionBrowsing
      ? `${destination.name}, for the plan you have.`
      : `${destination.name}, recommended by Detour members.`;
  const destinationTagline = 'Discover somewhere new, then recommend the places you love.';
  const country = destinationCountry(destination);
  const mapView = state.cityView === 'map' && hasMap;
  const destinationContent = `${discoveryBar(list, hasMap, mapView)}
      ${mapView ? mapStage(list) : cityListStage(destination, list, emptyState)}`;

  // Tear the live map down before its container is replaced below. Leaflet
  // reaches back into the element on remove(), and a pan or zoom still in
  // flight throws once that element is detached.
  destroyMap();

  root.innerHTML = `
    <a class="skip-link" href="${mapView ? '#venue-map' : '#selection-results'}">Skip to discovery</a>
    ${mastheadMarkup()}
    <nav class="explore-breadcrumb destination-breadcrumb" aria-label="Breadcrumb">
      ${
        memberCanExplore()
          ? `<a href="${esc(exploreHref())}" data-explore>Explore</a>`
          : `<a href="${esc(homeHref())}" data-home>Home</a>`
      }
      ${
        country && memberCanExplore()
          ? `<span aria-hidden="true">/</span><a href="${esc(countryHref(country.slug))}" data-country="${esc(country.slug)}">${esc(country.name)}</a>`
          : ''
      }
      <span aria-hidden="true">/</span>
      <span aria-current="page">${esc(destination.name)}</span>
    </nav>
    <div class="hero city-detail-hero">
      <div class="hero-inner">
        <h1 id="destination-title" tabindex="-1">${esc(destinationTitle)}</h1>
        <p class="tagline">${esc(destinationTagline)}</p>
      </div>
    </div>
    ${destinationContent}
    <footer class="footer">
      <p>${FOOTER_TAGLINE}</p>
      ${tapeThemeToggleMarkup()}
    </footer>
  `;

  bindRouteLinks(root);
  // Notes from the Detour circle render inside the place detail; load the
  // circle feed here too so a direct destination link still surfaces them.
  ensureNetworkDiscovery(() => render(root), destination.name);

  const keepSelectionValid = () => {
    const visible = filteredVenues();
    if (state.selectedId && !visible.some((v) => v.id === state.selectedId)) {
      state.selectedId = null;
      state.selectedVia = null;
    }
  };

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
  root.querySelectorAll<HTMLButtonElement>('[data-city-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.cityView === 'map' ? 'map' : 'list';
      if (view === state.cityView) return;
      state.cityView = view;
      // A selection made in the view being left has no anchor in the new one:
      // a pin's detail belongs to the map, a card's to the list.
      if ((view === 'map') === (state.selectedVia === 'card')) {
        state.selectedId = null;
        state.selectedVia = null;
      }
      pendingFocus = `[data-city-view="${view}"]`;
      render(root);
    });
  });
  root.querySelector<HTMLButtonElement>('[data-city-notes-retry]')?.addEventListener('click', () => {
    pendingFocus = '[data-city-notes-retry]';
    retryNetworkPlaceNotes(() => render(root), destination.name);
  });
  root.querySelectorAll<HTMLButtonElement>('[data-chip]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const value = btn.dataset.chipValue ?? '';
      state.occasionFilters = state.occasionFilters.filter((occasion) => occasion !== value);
      keepSelectionValid();
      pendingFocus = '[data-occasion=""]';
      render(root);
    });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-clear-filters]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.occasionFilters = [];
      pendingFocus = '[data-occasion=""]';
      render(root);
    });
  });
  root.querySelector<HTMLButtonElement>('[data-geolocate]')?.addEventListener('click', () => {
    requestUserLocation(root);
  });
  // Failed card and detail covers become the same intentional monogram
  // fallback in place; the URL is remembered so later renders skip it without
  // re-requesting and dimensions remain stable.
  root.querySelectorAll<HTMLImageElement>('[data-cover-image]').forEach((img) => {
    img.addEventListener('error', () => showCoverFallback(img), { once: true });
    // A cached failure may complete before listeners are attached after the
    // render; cover that path explicitly so a broken image never flashes or
    // remains in either surface.
    if (img.complete && img.naturalWidth === 0) showCoverFallback(img);
  });
  root.querySelector<HTMLButtonElement>('[data-reset-filters]')?.addEventListener('click', () => {
    state.occasionFilters = [];
    pendingFocus = '[data-occasion=""]';
    render(root);
  });
  root.querySelector('[data-close]')?.addEventListener('click', () => {
    const closedId = state.selectedId;
    state.selectedId = null;
    state.selectedVia = null;
    // Return focus to the pin that opened the preview.
    pendingFocus = closedId === null ? '[data-city-view="map"]' : `[data-pin="${CSS.escape(closedId)}"]`;
    render(root);
  });

  // The map view owns the only map in this view; the place page carries its own
  // locator. Both were already torn down above, before the re-render.
  if (mapView) mountMap(root, list);

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
  let authIdentity = pb.authStore.isValid ? pb.authStore.record?.id || '' : '';
  pb.authStore.onChange((_token, record) => {
    const nextIdentity = pb.authStore.isValid ? record?.id || '' : '';
    if (nextIdentity === authIdentity) return;
    authIdentity = nextIdentity;
    resetNetworkDiscovery();
    render(root);
  }, false);
  applyRouteFromUrl(root);
  window.addEventListener('popstate', () => applyRouteFromUrl(root));
  refreshCatalogue()
    .then(() => {
      applyRouteFromUrl(root);
    })
    .catch(() => {
      state.mode = 'error';
      state.venues = [];
      applyRouteFromUrl(root);
    });
}
