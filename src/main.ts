import './styles.css';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { pb } from './pocketbase';
import { demoVenues, GUIDE_YEAR } from './data';
import type { AwardLevel, Venue } from './data';

type Filter = 0 | AwardLevel; // 0 = all
type DataMode = 'loading' | 'live' | 'demo';

interface UserLocation {
  lat: number;
  lng: number;
}

interface State {
  mode: DataMode;
  venues: Venue[];
  filter: Filter;
  /** '' = all sources; otherwise a source name present in the loaded data. */
  sourceFilter: string;
  selectedId: string | null;
  guideYear: number;
  userLocation: UserLocation | null;
  geoStatus: string;
  geoBusy: boolean;
}

const state: State = {
  mode: 'loading',
  venues: [],
  filter: 0,
  sourceFilter: '',
  selectedId: null,
  guideYear: GUIDE_YEAR,
  userLocation: null,
  geoStatus: '',
  geoBusy: false,
};

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
 * Parse an award level that may be stored as a number (3) or as a string
 * label like '1 Sol', '2 Soles', '3 Soles'. Returns null when unrecognized —
 * never guesses.
 */
function parseAwardLevel(...candidates: unknown[]): AwardLevel | null {
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) {
      const n = Math.round(c);
      if (n >= 1 && n <= 3) return n as AwardLevel;
    }
    if (typeof c === 'string') {
      const m = c.match(/([123])\s*(?:sol(?:es)?)?/i);
      if (m) {
        const n = Number(m[1]);
        if (n >= 1 && n <= 3) return n as AwardLevel;
      }
    }
  }
  return null;
}

function solesLabel(level: AwardLevel): string {
  return `${level} ${level === 1 ? 'Sol' : 'Soles'}`;
}

function solesIcons(level: AwardLevel): string {
  return '☀'.repeat(level);
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

  // Keep only current awards for the active guide year — Detour only makes
  // claims backed by the current published listing.
  const awardByVenue = new Map<string, Rec>();
  for (const a of awardRecs) {
    const vid = str(a.venue as string, a.venue_id as string);
    if (!vid) continue;
    if (a.current === false) continue;
    const year = num(a.year, a.guide_year);
    if (year !== null && year !== GUIDE_YEAR) continue;
    const prev = awardByVenue.get(vid);
    const prevYear = prev ? (num(prev.year, prev.guide_year) ?? 0) : -1;
    if (!prev || (year ?? 0) >= prevYear) awardByVenue.set(vid, a);
  }

  const venues: Venue[] = [];
  for (const v of venueRecs) {
    const id = String(v.id);
    const award = awardByVenue.get(id);
    if (!award) continue;
    // Award levels are stored as strings like '1 Sol' / '2 Soles' / '3 Soles'
    // in the live schema; parse those (and plain numbers) explicitly.
    const level = parseAwardLevel(
      award.level,
      award.soles,
      v.award_level,
      v.soles,
      v.award
    );
    if (level === null) continue;

    const sourceId = str(
      award.source as string,
      award.guide_source as string,
      v.source as string,
      v.guide_source as string
    );
    const source = sourceId ? sourceById.get(sourceId) : undefined;

    const note = str(
      award.verification_note as string,
      v.coord_verification_note,
      v.note,
      v.summary,
      v.description
    );

    // The backend stores 0/0 as a neutral "no verified coordinates" sentinel
    // (see the seed migrations). Treat it — and missing values — as unknown
    // location rather than plotting a fake pin.
    const rawLat = num(v.lat, v.latitude);
    const rawLng = num(v.lng, v.lon, v.longitude);
    const hasCoords =
      rawLat !== null && rawLng !== null && !(rawLat === 0 && rawLng === 0);
    const lat = hasCoords ? rawLat : null;
    const lng = hasCoords ? rawLng : null;

    venues.push({
      id,
      name: str(v.name, v.title) || 'Unnamed venue',
      award: level,
      awardYear: num(award.year, award.guide_year, v.award_year) ?? GUIDE_YEAR,
      cuisine: str(v.cuisine, v.category, v.style),
      neighborhood: str(v.neighborhood, v.district, v.area),
      address: str(v.address, v.street_address),
      lat,
      lng,
      sourceName: str(
        source?.name as string,
        source?.title as string,
        award.source_name as string,
        v.source_name as string
      ) || 'Guía Repsol',
      sourceUrl: str(
        award.source_url as string,
        source?.official_url as string,
        source?.url as string,
        source?.website as string,
        v.source_url as string,
        v.website as string
      ),
      note,
      approxLocation:
        Boolean(v.approx_location ?? v.location_approximate) ||
        /approx|street-level/i.test(note),
    });
  }
  return venues;
}

/* ---------- rendering ---------- */

const FILTERS: { value: Filter; label: string }[] = [
  { value: 0, label: 'All' },
  { value: 3, label: '3 Soles' },
  { value: 2, label: '2 Soles' },
  { value: 1, label: '1 Sol' },
];

function sourceNames(): string[] {
  const names = new Set<string>();
  for (const v of state.venues) if (v.sourceName) names.add(v.sourceName);
  return [...names].sort((a, b) => a.localeCompare(b));
}

function filteredVenues(): Venue[] {
  const list = state.venues.filter(
    (v) =>
      (state.filter === 0 || v.award === state.filter) &&
      (state.sourceFilter === '' || v.sourceName === state.sourceFilter)
  );
  return [...list].sort((a, b) => b.award - a.award || a.name.localeCompare(b.name));
}

/* ---------- interactive map (Leaflet + OpenStreetMap) ---------- */

// Central Madrid fallback view used when there are no verified venue pins to
// derive bounds from, or when browser location is unavailable/denied.
const MADRID_CENTER: [number, number] = [40.4168, -3.7038];
const MADRID_ZOOM = 13;

type MappableVenue = Venue & { lat: number; lng: number };

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
  const pinKey = mappable.map((v) => v.id).join('|');
  if (pinKey !== savedPinKey) {
    savedPinKey = pinKey;
    savedView = null;
  }

  const map = L.map(container, {
    center: MADRID_CENTER,
    zoom: MADRID_ZOOM,
    scrollWheelZoom: false, // don't hijack page scroll
    zoomSnap: 0.5,
  });
  leafletMap = map;

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
  }).addTo(map);

  // Venue pins — only real, verified coordinates are ever plotted.
  for (const v of mappable) {
    const selected = v.id === state.selectedId;
    const icon = L.divIcon({
      className: '',
      html: `<span class="map-pin pin-${v.award}${selected ? ' pin-selected' : ''}">
        <span class="pin-dot"></span>
        <span class="pin-label">${esc(v.name)}</span>
      </span>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
    const marker = L.marker([v.lat, v.lng], {
      icon,
      keyboard: true,
      riseOnHover: true,
      zIndexOffset: selected ? 1000 : v.award * 10,
    }).addTo(map);
    marker.bindPopup(
      `<strong>${esc(v.name)}</strong><br>${solesIcons(v.award)} ${solesLabel(v.award)} · ${esc(
        v.sourceName
      )} ${v.awardYear}`,
      { closeButton: false, offset: [0, -6] }
    );
    const select = () => {
      state.selectedId = state.selectedId === v.id ? null : v.id;
      savedView = { center: map.getCenter(), zoom: map.getZoom() };
      render(root);
    };
    const el = marker.getElement();
    if (el) {
      el.setAttribute('role', 'button');
      el.setAttribute('aria-pressed', String(selected));
      el.setAttribute('aria-label', `${v.name}, ${solesLabel(v.award)}`);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        select();
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          select();
        }
      });
    }
    if (selected) marker.openPopup();
  }

  // User location — shown only when the browser granted a real position.
  if (state.userLocation) {
    L.circleMarker([state.userLocation.lat, state.userLocation.lng], {
      radius: 7,
      color: '#fdf6ec',
      weight: 2,
      fillColor: '#2563eb',
      fillOpacity: 1,
    })
      .addTo(map)
      .bindTooltip('Your approximate location');
  }

  // View: restore the user's last view, else fit the real pins, else Madrid.
  if (savedView) {
    map.setView(savedView.center, savedView.zoom, { animate: false });
  } else if (mappable.length > 0) {
    const bounds = L.latLngBounds(
      mappable.map((v) => [v.lat, v.lng] as [number, number])
    );
    // Include the user's marker in the frame only when it is near Madrid,
    // so a distant user never zooms the city map out to another region.
    const u = state.userLocation;
    if (u && u.lat > 40.2 && u.lat < 40.65 && u.lng > -3.95 && u.lng < -3.45) {
      bounds.extend([u.lat, u.lng]);
    }
    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 16 });
  }
  map.on('moveend zoomend', () => {
    savedView = { center: map.getCenter(), zoom: map.getZoom() };
  });
}

function mapPanel(list: Venue[]): string {
  const mappable = mappableVenues(list);
  const pending = list.length - mappable.length;
  const note =
    list.length === 0
      ? 'No venues match this filter — no pins to show. The map stays centered on Madrid.'
      : mappable.length === 0
        ? 'Locations pending verification — no verified venue pins to show yet. The map stays centered on Madrid.'
        : pending > 0
          ? `${pending} venue${pending === 1 ? '' : 's'} not pinned — location pending verification.`
          : '';
  return `<div class="map-panel map-panel-live" role="group" aria-label="Interactive map of listed venues in Madrid">
    <div id="venue-map" class="venue-map" aria-label="Madrid venue map — OpenStreetMap"></div>
    ${note ? `<p class="map-note" role="status">${esc(note)}</p>` : ''}
  </div>`;
}

function venueCard(v: Venue): string {
  const selected = v.id === state.selectedId;
  return `<li>
    <article class="card${selected ? ' card-selected' : ''}">
      <button type="button" class="card-main" data-venue="${esc(v.id)}" aria-expanded="${selected}">
        <div class="card-top">
          <h3>${esc(v.name)}</h3>
          <span class="award award-${v.award}" title="${solesLabel(v.award)} — Guía Repsol ${v.awardYear}">
            <span aria-hidden="true">${solesIcons(v.award)}</span> ${solesLabel(v.award)}
          </span>
        </div>
        <p class="card-meta">${esc([v.cuisine, v.neighborhood].filter(Boolean).join(' · '))}</p>
        <p class="card-address">${
          v.address
            ? `${esc(v.address)}${v.approxLocation ? ' <span class="approx">approx. location</span>' : ''}`
            : '<span class="approx">Location pending verification</span>'
        }</p>
      </button>
      <p class="card-source">Verified in <strong>${esc(v.sourceName)} ${v.awardYear}</strong>${
        v.sourceUrl
          ? ` · <a href="${esc(v.sourceUrl)}" target="_blank" rel="noopener noreferrer">view source ↗</a>`
          : ''
      }</p>
    </article>
  </li>`;
}

function detailPanel(): string {
  const v = state.venues.find((x) => x.id === state.selectedId);
  if (!v) {
    return `<aside class="detail detail-empty" aria-live="polite">
      <p>Select a venue from the list or the map to see its details.</p>
    </aside>`;
  }
  return `<aside class="detail" aria-live="polite" aria-label="Selected venue details">
    <div class="detail-head">
      <h2>${esc(v.name)}</h2>
      <button type="button" class="detail-close" data-close aria-label="Close details">✕</button>
    </div>
    <p class="detail-award award-${v.award}"><span aria-hidden="true">${solesIcons(v.award)}</span> ${solesLabel(
      v.award
    )} · ${esc(v.sourceName)} ${v.awardYear}</p>
    ${v.note ? `<p class="detail-note">${esc(v.note)}</p>` : ''}
    <dl class="detail-facts">
      ${v.cuisine ? `<div><dt>Cuisine</dt><dd>${esc(v.cuisine)}</dd></div>` : ''}
      ${v.neighborhood ? `<div><dt>Neighborhood</dt><dd>${esc(v.neighborhood)}</dd></div>` : ''}
      <div><dt>Address</dt><dd>${
        v.address
          ? `${esc(v.address)}${v.approxLocation ? ' <span class="approx">approximate location</span>' : ''}`
          : '<span class="approx">Location pending verification</span>'
      }</dd></div>
      <div><dt>Award source</dt><dd>${
        v.sourceUrl
          ? `<a href="${esc(v.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(v.sourceName)} ↗</a>`
          : esc(v.sourceName)
      }</dd></div>
    </dl>
  </aside>`;
}

function render(root: HTMLElement) {
  const list = filteredVenues();
  const demoBanner =
    state.mode === 'demo'
      ? `<p class="demo-banner" role="status">Showing a local demo selection — the live catalogue isn’t connected yet.</p>`
      : '';
  const loading = state.mode === 'loading';

  root.innerHTML = `
    <header class="hero">
      <div class="hero-inner">
        <p class="brand">Detour</p>
        <p class="brand-line" style="margin:0 0 0.6rem;font-size:0.85rem;letter-spacing:0.08em;font-style:italic;opacity:0.85;">Trust the experts. Great food is never a straight line.</p>
        <h1>Madrid’s trusted table, mapped.</h1>
        <p class="tagline">Every place on Detour holds a current award from a named guide — source first, always linked. This is a verified selection for Madrid right now, not a directory of the whole city.</p>
        <div class="hero-badges">
          <span class="badge badge-year">Guía Repsol · ${state.guideYear} guide year</span>
          <span class="badge">Source-attributed</span>
          <span class="badge">Madrid, Spain</span>
        </div>
      </div>
    </header>
    ${demoBanner}
    <section class="controls" aria-label="Filter venues by award level">
      <span class="controls-label" id="filter-label">Award level</span>
      <div class="filters" role="group" aria-labelledby="filter-label">
        ${FILTERS.map(
          (f) => `<button type="button" class="filter${state.filter === f.value ? ' filter-active' : ''}"
            data-filter="${f.value}" aria-pressed="${state.filter === f.value}">${f.label}</button>`
        ).join('')}
      </div>
      <span class="count" aria-live="polite">${loading ? 'Loading…' : `${list.length} venue${list.length === 1 ? '' : 's'}`}</span>
    </section>
    <section class="controls" aria-label="Filter venues by guide source">
      <span class="controls-label" id="source-label">Guide source</span>
      <div class="filters" role="group" aria-labelledby="source-label">
        <button type="button" class="filter${state.sourceFilter === '' ? ' filter-active' : ''}"
          data-source="" aria-pressed="${state.sourceFilter === ''}">All</button>
        ${sourceNames()
          .map(
            (name) => `<button type="button" class="filter${state.sourceFilter === name ? ' filter-active' : ''}"
              data-source="${esc(name)}" aria-pressed="${state.sourceFilter === name}">${esc(name)}</button>`
          )
          .join('')}
      </div>
    </section>
    <section class="controls" aria-label="Your location">
      <span class="controls-label" id="geo-label">Your location</span>
      <div class="filters" role="group" aria-labelledby="geo-label">
        <button type="button" class="filter" data-geolocate ${state.geoBusy ? 'disabled' : ''}>
          ${state.geoBusy ? 'Locating…' : 'Use my location'}
        </button>
      </div>
      ${state.geoStatus ? `<span class="count" role="status">${esc(state.geoStatus)}</span>` : ''}
    </section>
    <div class="layout">
      <section class="results" aria-label="Venue results">
        ${
          loading
            ? '<p class="loading">Loading the current selection…</p>'
            : list.length
              ? `<ul class="card-list">${list.map(venueCard).join('')}</ul>`
              : '<p class="loading">No venues match this award level.</p>'
        }
      </section>
      <div class="side">
        ${loading ? '<div class="map-panel"><p class="map-empty">Loading map…</p></div>' : mapPanel(list)}
        ${detailPanel()}
      </div>
    </div>
    <footer class="footer">
      <p>Detour lists a current, verified selection of awarded Madrid venues. Awards belong to their guides; follow each source link for the official listing.</p>
    </footer>
  `;

  root.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filter = Number(btn.dataset.filter) as Filter;
      const visible = filteredVenues();
      if (state.selectedId && !visible.some((v) => v.id === state.selectedId)) {
        state.selectedId = null;
      }
      render(root);
    });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-source]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.sourceFilter = btn.dataset.source ?? '';
      const visible = filteredVenues();
      if (state.selectedId && !visible.some((v) => v.id === state.selectedId)) {
        state.selectedId = null;
      }
      render(root);
    });
  });
  root.querySelector<HTMLButtonElement>('[data-geolocate]')?.addEventListener('click', () => {
    requestUserLocation(root);
  });
  root.querySelectorAll<HTMLButtonElement>('[data-venue]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.venue ?? null;
      state.selectedId = state.selectedId === id ? null : id;
      render(root);
      root.querySelector('.detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });
  root.querySelector('[data-close]')?.addEventListener('click', () => {
    state.selectedId = null;
    render(root);
  });

  // (Re)create the Leaflet map after the DOM has been replaced.
  mountMap(root, list);
}

/* ---------- geolocation (opt-in only) ---------- */

const GEO_FALLBACK =
  'We couldn’t get your location, so the map stays centered on Madrid — everything else works as usual.';

function requestUserLocation(root: HTMLElement): void {
  if (state.geoBusy) return;
  if (!('geolocation' in navigator)) {
    state.userLocation = null;
    state.geoStatus = GEO_FALLBACK;
    render(root);
    return;
  }
  state.geoBusy = true;
  state.geoStatus = 'Requesting your location…';
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
        state.geoStatus = GEO_FALLBACK;
      } else {
        state.userLocation = { lat: latitude, lng: longitude };
        state.geoStatus =
          'Your location is shown on the map as a blue dot.';
        savedView = null; // refit / recenter so the user sees their marker context
      }
      render(root);
    },
    () => {
      state.geoBusy = false;
      state.userLocation = null;
      state.geoStatus = GEO_FALLBACK;
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
        state.guideYear = venues.reduce((y, v) => Math.max(y, v.awardYear), 0) || GUIDE_YEAR;
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
