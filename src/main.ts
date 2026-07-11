import './styles.css';
import { pb } from './pocketbase';
import { demoVenues, GUIDE_YEAR } from './data';
import type { AwardLevel, Venue } from './data';

type Filter = 0 | AwardLevel; // 0 = all
type DataMode = 'loading' | 'live' | 'demo';

interface State {
  mode: DataMode;
  venues: Venue[];
  filter: Filter;
  selectedId: string | null;
  guideYear: number;
}

const state: State = {
  mode: 'loading',
  venues: [],
  filter: 0,
  selectedId: null,
  guideYear: GUIDE_YEAR,
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

  const awardByVenue = new Map<string, Rec>();
  for (const a of awardRecs) {
    const vid = str(a.venue as string, a.venue_id as string);
    if (!vid) continue;
    const prev = awardByVenue.get(vid);
    const year = num(a.year, a.guide_year) ?? 0;
    const prevYear = prev ? (num(prev.year, prev.guide_year) ?? 0) : -1;
    if (!prev || year >= prevYear) awardByVenue.set(vid, a);
  }

  const venues: Venue[] = [];
  for (const v of venueRecs) {
    const id = String(v.id);
    const award = awardByVenue.get(id);
    const levelRaw =
      num(award?.level, award?.soles, v.award_level, v.soles, v.award) ?? 0;
    const level = Math.min(3, Math.max(1, Math.round(levelRaw))) as AwardLevel;
    if (levelRaw < 1) continue;

    const sourceId = str(
      award?.source as string,
      award?.guide_source as string,
      v.source as string,
      v.guide_source as string
    );
    const source = sourceId ? sourceById.get(sourceId) : undefined;

    const note = str(v.coord_verification_note, v.note, v.summary, v.description);

    const lat = num(v.lat, v.latitude);
    const lng = num(v.lng, v.lon, v.longitude);
    if (lat === null || lng === null) continue;

    venues.push({
      id,
      name: str(v.name, v.title) || 'Unnamed venue',
      award: level,
      awardYear: num(award?.year, award?.guide_year, v.award_year) ?? GUIDE_YEAR,
      cuisine: str(v.cuisine, v.category, v.style),
      neighborhood: str(v.neighborhood, v.district, v.area),
      address: str(v.address, v.street_address),
      lat,
      lng,
      sourceName: str(
        source?.name as string,
        source?.title as string,
        award?.source_name as string,
        v.source_name as string
      ) || 'Guía Repsol',
      sourceUrl: str(
        award?.source_url as string,
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

function filteredVenues(): Venue[] {
  const list =
    state.filter === 0
      ? state.venues
      : state.venues.filter((v) => v.award === state.filter);
  return [...list].sort((a, b) => b.award - a.award || a.name.localeCompare(b.name));
}

function mapPanel(list: Venue[]): string {
  if (list.length === 0) {
    return '<div class="map-panel" aria-hidden="true"><p class="map-empty">No pins for this filter.</p></div>';
  }
  const lats = list.map((v) => v.lat);
  const lngs = list.map((v) => v.lng);
  const pad = 0.006;
  const minLat = Math.min(...lats) - pad;
  const maxLat = Math.max(...lats) + pad;
  const minLng = Math.min(...lngs) - pad;
  const maxLng = Math.max(...lngs) + pad;

  const pins = list
    .map((v) => {
      const x = ((v.lng - minLng) / (maxLng - minLng)) * 100;
      const y = ((maxLat - v.lat) / (maxLat - minLat)) * 100;
      const selected = v.id === state.selectedId;
      return `<button type="button" class="pin pin-${v.award}${selected ? ' pin-selected' : ''}"
        style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%"
        data-venue="${esc(v.id)}"
        aria-pressed="${selected}"
        aria-label="${esc(v.name)}, ${solesLabel(v.award)}">
        <span class="pin-dot"></span>
        <span class="pin-label">${esc(v.name)}</span>
      </button>`;
    })
    .join('');

  return `<div class="map-panel" role="group" aria-label="Approximate placement map of listed venues">
    <div class="map-grid" aria-hidden="true"></div>
    <span class="map-compass" aria-hidden="true">N ↑</span>
    ${pins}
    <p class="map-caption">Placement sketch — relative positions, not a street map.</p>
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
        <p class="card-address">${esc(v.address)}${v.approxLocation ? ' <span class="approx">approx. location</span>' : ''}</p>
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
      <div><dt>Address</dt><dd>${esc(v.address)}${
        v.approxLocation ? ' <span class="approx">approximate location</span>' : ''
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
        <p class="brand-line" style="margin:0 0 0.6rem;font-size:0.85rem;letter-spacing:0.08em;font-style:italic;opacity:0.85;">Worth a detour.</p>
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
