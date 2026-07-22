import './styles.css';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { citySlug, loadLiveCatalogue } from './data';
import type { Venue } from './data';
import { GLOBAL_META_DESCRIPTION, GLOBAL_META_TITLE } from './cities';
import { OCCASION_OPTIONS, occasionLabel } from './occasions';
import { applyInvitationRoute, bindCommunity, communityControl, communityPanel, openRecommendPlace, openSharePlace } from './community';
import { pb } from './pocketbase';
import { bindNetworkDiscovery, ensureNetworkDiscovery, networkDiscoveryMarkup, networkPlaceNotes, resetNetworkDiscovery } from './network';
import { renderFoundingSurvey } from './survey';

type DataMode = 'loading' | 'live' | 'error';
type AppView = 'home' | 'destination' | 'account' | 'survey';

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
  /** San Francisco-only multi-select occasion browsing; selected values compose as AND. */
  occasionFilters: string[];
  selectedId: string | null;
  /** Whether the last selection came from a map pin or a list card — used to restore focus on close. */
  selectedVia: 'pin' | 'card' | null;
  /** Whether the full filtered selection is currently revealed. */
  selectionOpen: boolean;
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
  pendingDestination: null,
  venues: [],
  occasionFilters: [],
  selectedId: null,
  selectedVia: null,
  selectionOpen: false,
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

/* ---------- brand ---------- */

/** Detour mark — keep in sync with the favicon artwork in index.html. */
function brandMark(): string {
  return `<svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><rect width="64" height="64" rx="12" fill="#6e5493"/><path d="M11 13h42v26H39L32 52l-7-13H11z" fill="#87c2a5"/><path d="M39 39h14V26z" fill="#86231e"/><path d="M24 22h16v6H24z" fill="#86231e"/></svg>`;
}

/* ---------- public member-list framing ---------- */

const MEMBER_RECOMMENDED_NOTE = 'Recommended by Detour members.';

/**
 * Aggregate member signal for one place, e.g. "Recommended or shared by 4
 * Detourists"; null when no count is known (the generic membership note is
 * the fallback). Every published place is member-recommended, so no lane
 * label accompanies it.
 */
function detouristSignal(v: Venue): string | null {
  const count = v.detouristCount ?? 0;
  if (count < 1) return null;
  return `Recommended or shared by ${count} Detourist${count === 1 ? '' : 's'}`;
}

function detouristNote(v: Venue): string {
  const signal = detouristSignal(v);
  return signal ? `${signal}.` : MEMBER_RECOMMENDED_NOTE;
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
  state.occasionFilters = [];
  state.selectedId = null;
  state.selectedVia = null;
  state.selectionOpen = false;
  state.geoStatus = '';
  state.geoBusy = false;
  savedView = null;
  savedPinKey = '';
}

function routeHref(view: AppView, slug: string | null): string {
  const url = new URL(window.location.href);
  url.pathname = view === 'survey' ? '/survey' : '/';
  url.searchParams.delete('city');
  if (view === 'destination' && slug) url.searchParams.set('d', slug);
  else url.searchParams.delete('d');
  if (view === 'account') url.searchParams.set('view', 'members');
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
  pendingFocus = '#network-home-title';
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
  const surveyPath = url.pathname.replace(/\/+$/, '') === '/survey';
  const invitationCode = surveyPath ? null : url.searchParams.get('invite');
  const nextView: AppView = surveyPath
    ? 'survey'
    : url.searchParams.get('view') === 'members' || invitationCode?.trim()
      ? 'account'
      : 'home';
  // Legacy ?city= links resolve to the same destination.
  const requested = surveyPath
    ? null
    : (url.searchParams.get('d') || url.searchParams.get('city') || '').trim().toLowerCase() || null;

  applyInvitationRoute(invitationCode);
  if (state.destination !== requested) resetDestinationState();
  state.destination = requested;
  state.pendingDestination = null;
  state.view = nextView === 'survey' ? 'survey' : nextView === 'account' ? 'account' : requested ? 'destination' : 'home';

  if (!surveyPath && url.searchParams.has('city')) updateRoute(state.view, requested, 'replace');
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

  // Venue pins — every public place uses the same member-list treatment.
  for (const v of mappable) {
    const selected = v.id === state.selectedId;
    const icon = L.divIcon({
      className: '',
      html: `<span class="map-pin pin-detourist${selected ? ' pin-selected' : ''}" data-pin="${esc(v.id)}">
        <span class="pin-pearl" aria-hidden="true">
          <span class="pin-signal"></span>
        </span>
        <span class="pin-label">${esc(v.name)}<small>${esc(detouristNote(v))}</small></span>
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
    marker.bindPopup(
      `<strong>${esc(v.name)}</strong><br><span class="popup-member">${esc(detouristNote(v))}</span>${isSanFranciscoDestination() && venueOccasions(v).length ? `<br><span class="popup-occasions">Good for: ${esc(occasionSummary(v))}</span>` : ''}`,
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
          `${v.name}, ${detouristNote(v)}${isSanFranciscoDestination() && venueOccasions(v).length ? ` Good for ${occasionSummary(v)}.` : ''} ${selected ? 'Selected.' : 'Select for details.'}`
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

function discoveryBar(list: Venue[], hasMap: boolean): string {
  return `<section class="discovery" aria-label="Explore the selection">
    <div class="discovery-row">
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
    ${refineChips()}
    ${state.geoStatus ? `<p class="geo-status" role="status">${esc(state.geoStatus)}</p>` : ''}
  </section>`;
}

// Cover URLs that failed to load this session; those venues render the
// monogram placeholder directly instead of retrying a dead image every render.
const failedCoverUrls = new Set<string>();

function coverInitial(v: Venue): string {
  return (v.name.trim().charAt(0) || '•').toUpperCase();
}

/**
 * Editorial cover for a place card. Venues without a usable image (or whose
 * image failed to load) get a serif monogram placeholder so every card keeps
 * the same silhouette. Decorative: the venue name is already the card heading.
 */
function venueCover(v: Venue): string {
  const image = safeExternalHref(v.imageUrl);
  const usable = image && !failedCoverUrls.has(image);
  return `<figure class="card-cover${usable ? '' : ' card-cover-placeholder'}" data-cover-initial="${esc(coverInitial(v))}" aria-hidden="true">${
    usable
      ? `<img src="${esc(image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-cover-image>`
      : `<span>${esc(coverInitial(v))}</span>`
  }</figure>`;
}

function venueCard(v: Venue): string {
  const selected = v.id === state.selectedId;
  const distinctLocality = hasDistinctLocality(v);
  return `<li>
    <article class="card card-detourist${selected ? ' card-selected' : ''}">
      <button type="button" class="card-main" data-venue="${esc(v.id)}" aria-expanded="${selected}">
        ${venueCover(v)}
        <h3>${esc(v.name)}</h3>
        <p class="card-meta">${esc([v.category, v.neighborhood].filter(Boolean).join(' · '))}</p>
        ${distinctLocality ? `<p class="card-locality"><span>${esc(v.city)}</span><small>${esc(venueRouteName(v))} selection</small></p>` : ''}
        <p class="card-address">${
          v.address
            ? esc(v.address)
            : '<span class="approx">Map position being refined</span>'
        }</p>
        ${isSanFranciscoDestination() && venueOccasions(v).length ? `<span class="card-occasions" aria-label="Good for ${esc(occasionSummary(v))}"><span class="card-occasions-label">Good for</span>${venueOccasions(v).map((occasion) => `<span>${esc(occasionLabel(occasion))}</span>`).join('')}</span>` : ''}
      </button>
      <p class="card-list-note">${esc(detouristNote(v))}</p>
    </article>
  </li>`;
}

function shortDate(value: string | undefined): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(parsed);
}

/**
 * Notes fellow Detourists attached when recommending this place, drawn from
 * the shared circle discovery feed. Empty for signed-out visitors and for
 * places nobody in the Detour circle has annotated.
 */
function networkNotesBlock(v: Venue): string {
  const name = normalizePlacePart(v.name);
  if (!name) return '';
  const city = normalizePlacePart(v.city);
  const notes = networkPlaceNotes().filter((item) => {
    if (normalizePlacePart(item.venue_name || '') !== name) return false;
    const itemCity = normalizePlacePart(item.city || '');
    return !itemCity || !city || itemCity === city;
  });
  if (notes.length === 0) return '';
  return `<div class="detail-network" role="group" aria-label="Notes from the Detour circle">
    <h4>From the Detour circle</h4>
    ${notes
      .map((item) => {
        const pseudo = item.recommender_pseudo?.trim().replace(/^@+/, '');
        const memberLabel = pseudo ? `@${pseudo}` : 'A Detour member';
        const when = shortDate(item.created);
        return `<blockquote class="detail-network-note">
          <p>${esc(item.note || '')}</p>
          <footer><strong class="network-pseudo">${esc(memberLabel)}</strong>${when ? `<span aria-hidden="true"> · </span><time datetime="${esc(item.created || '')}">${esc(when)}</time>` : ''}</footer>
        </blockquote>`;
      })
      .join('')}
  </div>`;
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
  const distinctLocality = hasDistinctLocality(v);
  const signal = detouristSignal(v);
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
      <section class="detail-recommendation" aria-labelledby="detail-recommendation-title">
        <h3 id="detail-recommendation-title">Why it’s here</h3>
        ${(() => {
          const cover = safeExternalHref(v.imageUrl);
          return cover && !failedCoverUrls.has(cover)
            ? `<figure class="detail-cover"><img src="${esc(cover)}" alt="${esc(v.name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-cover-image></figure>`
            : '';
        })()}
        <p class="detail-note">${esc(
          signal
            ? `${signal} — a place worth a deliberate detour.`
            : 'Recommended by Detour members as a place worth a deliberate detour.'
        )}</p>
        ${networkNotesBlock(v)}
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
      ? `Detour — Member-recommended places in ${destinationName}`
      : GLOBAL_META_TITLE;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (meta) {
    meta.setAttribute(
      'content',
      account
        ? 'Sign in to Detour membership to manage invitations, recommend places, and exchange private place shares.'
        : destinationName
          ? destinationName === 'San Francisco'
            ? 'Browse member-recommended Detourist List places in San Francisco by occasion, from celebrations to quick local stops.'
            : `Explore member-recommended Detourist List places in ${destinationName}, with practical details and a map for planning your next detour.`
          : GLOBAL_META_DESCRIPTION
    );
  }
}

function bindRouteLinks(root: HTMLElement): void {
  root.querySelectorAll<HTMLAnchorElement>('[data-community-route]').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const target = link.getAttribute('data-community-route');
      const preset = target === 'share-place' ? openSharePlace : target === 'recommend-place' ? openRecommendPlace : null;
      preset?.();
      if (state.view !== 'account') showAccount(root);
      else if (preset) render(root);
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
      const venueId = el.dataset.openVenue ?? '';
      openDestination(root, slug);
      if (venueId && destinationVenues().some((v) => v.id === venueId)) {
        state.selectedId = venueId;
        state.selectedVia = 'card';
        state.selectionOpen = true;
        render(root);
      }
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
      <p>Members appear by pseudo. Direct shares and replies stay private, while recommendations are discoverable across the invite-only circle.</p>
    </footer>
  `;

  bindCommunity(root, state.venues, () => render(root), () => showHome(root));
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
function resolveNetworkPlace(venueName: string, city: string): { venueId: string; destinationSlug: string; imageUrl?: string } | null {
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
    imageUrl: image && !failedCoverUrls.has(image) ? image : undefined,
  };
}

function renderHome(root: HTMLElement): void {
  destroyMap();
  syncDocumentMeta(null);
  const covered = destinations();
  const catalogueStatus =
    state.mode === 'loading'
      ? '<p class="network-search-status loading" role="status">Preparing place search…</p>'
      : state.mode === 'error'
        ? '<p class="network-search-status is-error" role="status">Place search is unavailable right now. Your Detour circle remains available.</p>'
        : covered.length === 0
          ? '<p class="network-search-status" role="status">There are no published places to search at the moment.</p>'
          : '';
  const searchOptions =
    state.mode !== 'live'
      ? ''
      : covered
          .map((d) => `<option value="${esc(d.country ? `${d.name}, ${d.country}` : d.name)}"></option>`)
          .join('') +
        [
          ...new Set(
            allVenues()
              .filter(hasDistinctLocality)
              .map((v) => (v.country ? `${v.city}, ${v.country}` : v.city))
          ),
        ]
          .sort((a, b) => a.localeCompare(b))
          .map((city) => `<option value="${esc(city)}"></option>`)
          .join('');

  root.innerHTML = `
    <a class="skip-link" href="#network-home-title">Skip to circle discovery</a>
    <header class="network-masthead">
      <p class="network-brand">${brandMark()}Detour</p>
      ${communityControl(accountHref())}
    </header>
    ${networkDiscoveryMarkup(accountHref(), resolveNetworkPlace)}
    <section class="network-search-context" aria-labelledby="network-search-title">
      <div class="network-search-heading">
        <div><h2 id="network-search-title">Find your city</h2><p>Search by city when you want the wider Detour selection. Each city opens with every place members recommend there.</p></div>
      </div>
      <form class="destination-search network-destination-search" data-destination-search role="search" aria-label="Find a city">
        <label for="destination-search">City or destination</label>
        <div class="network-search-controls">
          <input id="destination-search" name="query" type="search" list="destination-search-options" autocomplete="off" spellcheck="false" placeholder="Madrid, San Francisco…" ${state.mode !== 'live' ? 'disabled' : ''}>
          <datalist id="destination-search-options">${searchOptions}</datalist>
          <button class="destination-go" type="submit" ${state.mode !== 'live' ? 'disabled' : ''}>Search</button>
          <button class="destination-near" type="button" data-geolocate ${state.geoBusy || state.mode !== 'live' ? 'disabled' : ''}>${state.geoBusy ? 'Finding you…' : 'Use my location'}</button>
        </div>
      </form>
      ${catalogueStatus}
      ${state.geoStatus ? `<p class="geo-status" role="status">${esc(state.geoStatus)}</p>` : ''}
    </section>
    <footer class="footer network-footer">
      <p>Recommendations stay within the invite-only Detour circle. Direct shares and replies remain private.</p>
    </footer>
  `;

  bindRouteLinks(root);
  bindNetworkDiscovery(root, () => render(root));
  // A feed thumb that fails to load disappears; the URL is remembered so
  // later renders skip it without re-requesting.
  root.querySelectorAll<HTMLImageElement>('[data-network-thumb]').forEach((img) => {
    img.addEventListener('error', () => {
      failedCoverUrls.add(img.src);
      img.closest('.network-entry')?.classList.remove('network-entry-with-thumb');
      img.closest('.network-entry-thumb')?.remove();
    });
  });
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
        <p>Built from recommendations by Detour members. Take a detour.</p>
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
    : `${destination.name}, recommended by Detour members.`;
  const destinationTagline = sanFrancisco
    ? `${destination.count} current ${destination.count === 1 ? 'place' : 'places'}. Browse by occasion, from celebrations and date nights to neighborhood meals and quick local stops.`
    : `${destination.count} ${destination.count === 1 ? 'place' : 'places'} on the member-recommended Detourist List.`;

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
      <p>Recommended by members. Ready for your next detour.</p>
    </footer>
  `;

  bindRouteLinks(root);
  // Notes from the Detour circle render inside the place detail; load the
  // circle feed here too so a direct destination link still surfaces them.
  ensureNetworkDiscovery(() => render(root));

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
  root.querySelector<HTMLButtonElement>('[data-selection-toggle]')?.addEventListener('click', () => {
    state.selectionOpen = !state.selectionOpen;
    if (!state.selectionOpen && state.selectedVia === 'card') state.selectedVia = null;
    pendingFocus = '[data-selection-toggle]';
    render(root);
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
  // A cover that fails to load falls back to the monogram placeholder in
  // place (cards) or disappears (detail); the URL is remembered so later
  // renders skip it without re-requesting.
  root.querySelectorAll<HTMLImageElement>('[data-cover-image]').forEach((img) => {
    img.addEventListener('error', () => {
      failedCoverUrls.add(img.src);
      const figure = img.closest<HTMLElement>('.card-cover, .detail-cover');
      if (!figure) return;
      if (figure.classList.contains('card-cover')) {
        figure.classList.add('card-cover-placeholder');
        figure.textContent = '';
        const initial = document.createElement('span');
        initial.textContent = figure.dataset.coverInitial || '•';
        figure.append(initial);
      } else {
        figure.remove();
      }
    });
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
  loadLiveCatalogue()
    .then(({ venues }) => {
      state.mode = 'live';
      state.venues = venues;
      applyRouteFromUrl(root);
    })
    .catch(() => {
      state.mode = 'error';
      state.venues = [];
      applyRouteFromUrl(root);
    });
}
