import './styles.css';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { pb } from './pocketbase';
import { demoVenues, GUIDE_YEAR } from './data';
import type { Venue, VenueAward } from './data';

/** '' = all award levels; otherwise a literal level label present in the loaded data. */
type Filter = string;
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
  /** Free-text venue-name search; matched case-insensitively after trimming. */
  search: string;
  selectedId: string | null;
  guideYear: number;
  userLocation: UserLocation | null;
  geoStatus: string;
  geoBusy: boolean;
}

const state: State = {
  mode: 'loading',
  venues: [],
  filter: '',
  sourceFilter: '',
  search: '',
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

/** Awards sorted highest rank first, then by label and guide name for stability. */
function sortAwards(awards: VenueAward[]): VenueAward[] {
  return [...awards].sort(
    (a, b) =>
      (b.awardRank ?? -1) - (a.awardRank ?? -1) ||
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

/** Plain-text summary of every award, keeping each guide's own wording. */
function awardSummary(v: Venue): string {
  return v.awards
    .map((a) => `${a.awardLevel} — ${a.sourceName} ${a.awardYear}`)
    .join('; ');
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

    const sourceId = str(
      award.source as string,
      award.guide_source as string,
      venue.source as string,
      venue.guide_source as string
    );
    const source = sourceId ? sourceById.get(sourceId) : undefined;
    const note = str(
      award.verification_note as string,
      venue.coord_verification_note,
      venue.note,
      venue.summary,
      venue.description
    );

    // The backend stores 0/0 as a neutral "no verified coordinates" sentinel
    // (see the seed migrations). Treat it — and missing values — as unknown
    // location rather than plotting a fake pin.
    const rawLat = num(venue.lat, venue.latitude);
    const rawLng = num(venue.lng, venue.lon, venue.longitude);
    const hasCoords =
      rawLat !== null && rawLng !== null && !(rawLat === 0 && rawLng === 0);
    const lat = hasCoords ? rawLat : null;
    const lng = hasCoords ? rawLng : null;

    const venueAward: VenueAward = {
      awardLevel: level,
      awardRank: awardRankOf(level),
      awardYear: year ?? GUIDE_YEAR,
      sourceName:
        str(
          source?.name as string,
          source?.title as string,
          award.source_name as string,
          venue.source_name as string
        ) || (source ? 'Unknown guide' : 'Unknown source'),
      sourceUrl: str(
        award.source_url as string,
        source?.official_url as string,
        source?.url as string,
        source?.website as string,
        venue.source_url as string,
        venue.website as string
      ),
      note,
    };

    const existing = venuesById.get(venueId);
    if (existing) {
      existing.awards.push(venueAward);
      existing.approxLocation =
        existing.approxLocation || /approx|street-level/i.test(note);
      continue;
    }

    venuesById.set(venueId, {
      id: venueId,
      name: str(venue.name, venue.title) || 'Unnamed venue',
      awards: [venueAward],
      cuisine: str(venue.cuisine, venue.category, venue.style),
      neighborhood: str(venue.neighborhood, venue.district, venue.area),
      address: str(venue.address, venue.street_address),
      lat,
      lng,
      approxLocation:
        Boolean(venue.approx_location ?? venue.location_approximate) ||
        /approx|street-level/i.test(note),
    });
  }
  const venues = [...venuesById.values()];
  for (const v of venues) v.awards = sortAwards(v.awards);
  return venues;
}

/* ---------- rendering ---------- */

/** Award-level filter options derived from the loaded data's literal labels. */
function awardFilters(): { value: Filter; label: string }[] {
  const seen = new Map<string, number | null>();
  for (const v of state.venues) {
    for (const a of v.awards) {
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

function sourceNames(): string[] {
  const names = new Set<string>();
  for (const v of state.venues)
    for (const a of v.awards) if (a.sourceName) names.add(a.sourceName);
  return [...names].sort((a, b) => a.localeCompare(b));
}

function filteredVenues(): Venue[] {
  const query = state.search.trim().toLowerCase();
  // A filter matches when ANY of the venue's awards matches, so a venue
  // recognised by several guides stays visible under each guide's filter.
  const list = state.venues.filter(
    (v) =>
      (state.filter === '' || v.awards.some((a) => a.awardLevel === state.filter)) &&
      (state.sourceFilter === '' ||
        v.awards.some((a) => a.sourceName === state.sourceFilter)) &&
      (query === '' || v.name.toLowerCase().includes(query))
  );
  return [...list].sort(
    (a, b) =>
      maxAwardRank(b) - maxAwardRank(a) ||
      topAward(a).awardLevel.localeCompare(topAward(b).awardLevel) ||
      a.name.localeCompare(b.name)
  );
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
      html: `<span class="map-pin pin-${Math.max(maxAwardRank(v), 0)}${selected ? ' pin-selected' : ''}">
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
      zIndexOffset: selected ? 1000 : Math.max(maxAwardRank(v), 0) * 10,
    }).addTo(map);
    marker.bindPopup(
      `<strong>${esc(v.name)}</strong>${v.awards
        .map(
          (a) =>
            `<br>${awardIcons(a)} ${esc(a.awardLevel)} · ${esc(a.sourceName)} ${a.awardYear}`
        )
        .join('')}`,
      { closeButton: false, offset: [0, -6] }
    );
    const select = () => {
      state.selectedId = state.selectedId === v.id ? null : v.id;
      savedView = { center: map.getCenter(), zoom: map.getZoom() };
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
      ? 'No venues match your current search or filters — no pins to show. The map stays centered on Madrid.'
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
          <span class="card-awards" role="list" aria-label="${esc(awardSummary(v))}">
            ${v.awards
              .map(
                (a) => `<span role="listitem" class="award award-${a.awardRank ?? 0}" title="${esc(a.awardLevel)} — ${esc(a.sourceName)} ${a.awardYear}">
                  <span aria-hidden="true">${awardIcons(a)}</span> ${esc(a.awardLevel)}
                  <span class="award-guide">${esc(a.sourceName)}</span>
                </span>`
              )
              .join('')}
          </span>
        </div>
        <p class="card-meta">${esc([v.cuisine, v.neighborhood].filter(Boolean).join(' · '))}</p>
        <p class="card-address">${
          v.address
            ? `${esc(v.address)}${v.approxLocation ? ' <span class="approx">approx. location</span>' : ''}`
            : '<span class="approx">Location pending verification</span>'
        }</p>
      </button>
      <div class="card-sources">
        ${v.awards
          .map(
            (a) => `<p class="card-source">${esc(a.awardLevel)} verified in <strong>${esc(a.sourceName)} ${a.awardYear}</strong>${
              a.sourceUrl
                ? ` · <a href="${esc(a.sourceUrl)}" target="_blank" rel="noopener noreferrer">view source ↗</a>`
                : ''
            }</p>`
          )
          .join('')}
      </div>
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
    <ul class="detail-awards" aria-label="Awards">
      ${v.awards
        .map(
          (a) => `<li class="detail-award award-${a.awardRank ?? 0}"><span aria-hidden="true">${awardIcons(a)}</span> ${esc(
            a.awardLevel
          )} · ${esc(a.sourceName)} ${a.awardYear}</li>`
        )
        .join('')}
    </ul>
    ${[...new Set(v.awards.map((a) => a.note).filter(Boolean))]
      .map((note) => `<p class="detail-note">${esc(note)}</p>`)
      .join('')}
    <dl class="detail-facts">
      ${v.cuisine ? `<div><dt>Cuisine</dt><dd>${esc(v.cuisine)}</dd></div>` : ''}
      ${v.neighborhood ? `<div><dt>Neighborhood</dt><dd>${esc(v.neighborhood)}</dd></div>` : ''}
      <div><dt>Address</dt><dd>${
        v.address
          ? `${esc(v.address)}${v.approxLocation ? ' <span class="approx">approximate location</span>' : ''}`
          : '<span class="approx">Location pending verification</span>'
      }</dd></div>
      <div><dt>Award source${v.awards.length === 1 ? '' : 's'}</dt><dd>${v.awards
        .map(
          (a) =>
            `${esc(a.awardLevel)}: ${
              a.sourceUrl
                ? `<a href="${esc(a.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(a.sourceName)} ${a.awardYear} ↗</a>`
                : `${esc(a.sourceName)} ${a.awardYear}`
            }`
        )
        .join('<br>')}</dd></div>
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
          <span class="badge badge-year">${esc(sourceNames().join(' · ') || 'Guía Repsol')} · ${state.guideYear} guide year</span>
          <span class="badge">Source-attributed</span>
          <span class="badge">Madrid, Spain</span>
        </div>
      </div>
    </header>
    ${demoBanner}
    <section class="controls" aria-label="Filter venues by award level">
      <span class="controls-label" id="filter-label">Award level</span>
      <div class="filters" role="group" aria-labelledby="filter-label">
        ${awardFilters()
          .map(
            (f) => `<button type="button" class="filter${state.filter === f.value ? ' filter-active' : ''}"
            data-filter="${esc(f.value)}" aria-pressed="${state.filter === f.value}">${esc(f.label) || 'All'}</button>`
          )
          .join('')}
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
    <section class="controls" aria-label="Search venues by name">
      <label class="controls-label" for="venue-search">Search by name</label>
      <div class="search-control">
        <input type="search" id="venue-search" data-search
          value="${esc(state.search)}"
          placeholder="e.g. Casa, DiverXO…"
          autocomplete="off" spellcheck="false" />
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
              : `<div class="empty-state" role="status">
                  <p class="empty-state-title">No matching venues</p>
                  <p class="empty-state-body">Your current search and filters produced no matches. Try a different venue name, or start over.</p>
                  <button type="button" class="empty-state-reset" data-reset-filters>Clear search &amp; filters</button>
                </div>`
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
      state.filter = btn.dataset.filter ?? '';
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
  const searchInput = root.querySelector<HTMLInputElement>('[data-search]');
  searchInput?.addEventListener('input', () => {
    state.search = searchInput.value;
    const visible = filteredVenues();
    if (state.selectedId && !visible.some((v) => v.id === state.selectedId)) {
      state.selectedId = null;
    }
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
    state.search = '';
    render(root);
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
