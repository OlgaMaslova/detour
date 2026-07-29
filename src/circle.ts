import { pb } from './pocketbase';
import { groupedRecommendationCardMarkup } from './network';
import type { DiscoveryRecommendation, NetworkPlaceResolver } from './network';

/**
 * My Circle — the invitation graph the signed-in member belongs to.
 *
 * Detour only grows by personal invitation, so this is the trust structure of
 * the app made legible: who brought you in, who you brought in, and who is one
 * invitation further out with the connecting member named on the row. The
 * founding circle sits apart from all of that: it is not relational and reads
 * the same for every member.
 *
 * All of it comes from one server projection (`/api/detour/circle`), which
 * decides what is visible. Nothing here re-derives membership from collection
 * reads, and no row carries an email, a pseudo, a status, or an id.
 */

type CircleStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface CirclePerson {
  name: string;
  /** Self-declared home city — where the person is from. */
  home: string;
  /** Cities of the member's published places — recommendation geography, not a home address. */
  cities: string[];
  places: number;
  /** The member's most recent published place — the reason to follow their taste. */
  latest?: { place: string; created: string };
  /** Only on one-hop-out rows: the member who links this person to the caller. */
  connector?: string;
  /**
   * Positional reference to the connector — 'inviter' or 'invited:<n>' — so
   * the drawing can attach a spoke to the right inner-ring node even when two
   * members share a display name. No member id ever reaches the client.
   */
  connectorRef?: string;
}

interface CircleInvitations {
  limit: number;
  unclaimed: number;
  available: number;
}

interface CircleData {
  invitations: CircleInvitations;
  inviter: CirclePerson | null;
  invited: CirclePerson[];
  secondDegree: CirclePerson[];
  founding: { cap: number; seated: number; members: CirclePerson[] };
}

const EMPTY: CircleData = {
  invitations: { limit: 0, unclaimed: 0, available: 0 },
  inviter: null,
  invited: [],
  secondDegree: [],
  founding: { cap: 0, seated: 0, members: [] },
};

/** The drawing is the page; the list is the alternative reading of it. */
type CircleView = 'rings' | 'list';

let status: CircleStatus = 'idle';
let loadedFor = '';
let errorMessage = '';
let circle: CircleData = EMPTY;
let view: CircleView = 'rings';

/* Slide-over panel: which circle member is open, addressed by the same
   positional reference the payload uses, and a per-person cache of their
   published places. */
interface PanelPlacesState {
  status: 'loading' | 'ready' | 'error';
  isPrivate: boolean;
  items: DiscoveryRecommendation[];
}
let panelRef: string | null = null;
const panelPlaces = new Map<string, PanelPlacesState>();
let resolvePlaceFn: NetworkPlaceResolver | undefined;
/** The render callback of the current page, for the document-level Escape handler. */
let latestRender: (() => void) | null = null;
let panelDismissBound = false;

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function memberId(): string {
  return pb.authStore.isValid ? pb.authStore.record?.id || '' : '';
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanCount(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

/**
 * A person is only rendered when the projection actually named them. A row
 * without a display name would be an anonymous body in someone's circle, which
 * says nothing and reads as a bug.
 */
function cleanPerson(value: unknown): CirclePerson | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const name = cleanText(row.name, 100);
  if (!name) return null;
  const connector = cleanText(row.connector, 100);
  const connectorRef = cleanText(row.connector_ref, 20);
  const cities = Array.isArray(row.cities)
    ? row.cities
        .map((city) => cleanText(city, 120))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const latestRaw = (row.latest && typeof row.latest === 'object' ? row.latest : {}) as Record<
    string,
    unknown
  >;
  const latestPlace = cleanText(latestRaw.place, 200);
  return {
    name,
    home: cleanText(row.home, 120),
    cities,
    places: cleanCount(row.places),
    ...(latestPlace ? { latest: { place: latestPlace, created: cleanText(latestRaw.created, 40) } } : {}),
    ...(connector ? { connector } : {}),
    ...(/^(inviter|invited:\d+)$/.test(connectorRef) ? { connectorRef } : {}),
  };
}

function cleanPeople(value: unknown): CirclePerson[] {
  if (!Array.isArray(value)) return [];
  const people: CirclePerson[] = [];
  for (const item of value) {
    const person = cleanPerson(item);
    if (person) people.push(person);
  }
  return people;
}

function cleanPayload(value: unknown): CircleData {
  const payload = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const invitations = (
    payload.invitations && typeof payload.invitations === 'object' ? payload.invitations : {}
  ) as Record<string, unknown>;
  const founding = (
    payload.founding && typeof payload.founding === 'object' ? payload.founding : {}
  ) as Record<string, unknown>;
  return {
    invitations: {
      limit: cleanCount(invitations.limit),
      unclaimed: cleanCount(invitations.unclaimed),
      available: cleanCount(invitations.available),
    },
    inviter: cleanPerson(payload.inviter),
    invited: cleanPeople(payload.invited),
    secondDegree: cleanPeople(payload.second_degree),
    founding: {
      cap: cleanCount(founding.cap),
      seated: cleanCount(founding.seated),
      members: cleanPeople(founding.members),
    },
  };
}

function readableError(error: unknown): string {
  const fallback = 'Your circle is unavailable right now. Please try again shortly.';
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  return fallback;
}

async function loadCircle(render: () => void): Promise<void> {
  if (status === 'loading') return;
  const identity = memberId();
  if (!identity) return;
  status = 'loading';
  loadedFor = identity;
  errorMessage = '';
  render();
  try {
    const payload = await pb.send<unknown>('/api/detour/circle', { requestKey: null });
    // The member may have signed out or switched accounts mid-flight.
    if (memberId() !== identity) return;
    circle = cleanPayload(payload);
    status = 'ready';
  } catch (error) {
    if (memberId() !== identity) return;
    circle = EMPTY;
    status = 'error';
    errorMessage = readableError(error);
  }
  render();
}

/** Loads the circle once per signed-in member. Safe to call on every render. */
export function ensureCircle(render: () => void): void {
  const identity = memberId();
  if (!identity) return;
  if (loadedFor !== identity && status !== 'loading') {
    status = 'idle';
    void loadCircle(render);
  }
}

export function resetCircle(): void {
  status = 'idle';
  loadedFor = '';
  errorMessage = '';
  circle = EMPTY;
  panelRef = null;
  panelPlaces.clear();
}

/* ---------- markup ---------- */

type CircleRelation = 'inviter' | 'invited' | 'second';

function placeCount(places: number): string {
  return `${places} ${places === 1 ? 'place' : 'places'}`;
}

/**
 * The visible geography: one city is named, several become a count — the
 * full list is spoken on hover, like every other explanation here.
 */
function personGeography(person: CirclePerson): string {
  if (!person.places) return 'no places yet';
  const geography =
    person.cities.length === 1
      ? person.cities[0]
      : person.cities.length > 1
        ? `${person.cities.length} cities`
        : '';
  return [geography, placeCount(person.places)].filter(Boolean).join(' · ');
}

/**
 * The explanation of a person, spoken on hover over their node in the
 * drawing: the relationship as a sentence, then their published places, the
 * cities those places are in, and the latest of them. The list needs no
 * hover — its rows print all of this.
 */
/** The relationship as one short sentence — the panel kicker and the start of a node hover. */
function personSentence(person: CirclePerson, relation: CircleRelation | 'founding'): string {
  return relation === 'inviter'
    ? `${person.name} invited you`
    : relation === 'invited'
      ? `You invited ${person.name}`
      : relation === 'second'
        ? `${person.connector || 'A member'} invited ${person.name}`
        : `${person.name} — founding member`;
}

function personTitle(person: CirclePerson, relation: CircleRelation): string {
  // "olgaboss invited Tomás from Madrid · 2 places" — the home city rides
  // with the name; the footprint is just the count. The list rows carry the
  // fuller story (geography, latest place); the hover stays one glance long.
  const label = person.home ? `${person.name} from ${person.home}` : person.name;
  const sentence =
    relation === 'inviter'
      ? `${label} invited you`
      : relation === 'invited'
        ? `You invited ${label}`
        : `${person.connector || 'A member'} invited ${label}`;
  return `${sentence} · ${person.places ? placeCount(person.places) : 'no places yet'}`;
}

/**
 * Two tight lines, all left-aligned: name, then geography in small mono. The
 * right edge carries one thing only: the place count. No hover here — a row
 * already says everything the tooltip would; the places themselves are one
 * click away in the panel.
 */
function personRow(person: CirclePerson, relation: CircleRelation, ref: string): string {
  return `<li class="circle-person" data-circle-person="${esc(ref)}" role="button" tabindex="0" aria-haspopup="dialog" aria-label="${esc(`${personSentence(person, relation)} — open their places`)}">
    <div class="circle-person-main">
      <span class="circle-person-name">${esc(person.name)}${
        relation === 'second' && person.connector
          ? ` <span class="circle-person-provenance">· invited by ${esc(person.connector)}</span>`
          : ''
      }</span>
      <span class="circle-person-meta">${esc(personGeography(person))}</span>
    </div>
    ${person.places ? `<span class="circle-person-count">${person.places}</span>` : ''}
  </li>`;
}

function emptyNote(text: string): string {
  return `<p class="circle-empty">${esc(text)}</p>`;
}

/**
 * The list view: one ruled list, tiny group labels, one line per person.
 * Relational rows only — the Founding 50 lives on the satellite in the
 * rings view, not here.
 */
function listMarkup(): string {
  const { inviter, invited, secondDegree } = circle;
  const allGroups: { label: string; relation: CircleRelation; refPrefix: string; people: CirclePerson[] }[] = [
    { label: 'Your inviter', relation: 'inviter', refPrefix: 'inviter', people: inviter ? [inviter] : [] },
    { label: `You invited · ${invited.length}`, relation: 'invited', refPrefix: 'invited', people: invited },
    { label: `One hop out · ${secondDegree.length}`, relation: 'second', refPrefix: 'second', people: secondDegree },
  ];
  const groups = allGroups.filter((group) => group.people.length);
  if (!groups.length) return emptyNote('No one in your circle yet.');
  return `<ul class="circle-people" aria-label="Your circle as a list">${groups
    .map(
      (group) =>
        `<li class="circle-group-label">${esc(group.label)}</li>${group.people
          .map((person, index) =>
            personRow(
              person,
              group.relation,
              group.refPrefix === 'inviter' ? 'inviter' : `${group.refPrefix}:${index}`
            )
          )
          .join('')}`
    )
    .join('')}</ul>`;
}

/* ---------- the drawing ----------
   The same graph, literally as circles: the member at the centre, their two
   direct edges (inviter + invited) on the inner ring, one hop out on the
   outer. A spoke is an invitation; the dashed outer spokes are the provenance
   lines the list spells out in words. Positions are plain trigonometry over
   the payload, so the drawing is deterministic across re-renders. It is a
   picture of the lists above, not a second data source — the SVG is one
   labelled image, and the lists remain the accessible record. */

interface DrawnNode {
  person: CirclePerson;
  x: number;
  y: number;
  angle: number;
  kind: 'inviter' | 'invited' | 'second';
  /** Positional panel reference ('inviter', 'invited:<n>', 'second:<n>'). */
  ref: string;
}

/** Nodes are legible up to roughly this many people; past it, draw nothing. */
const DRAWING_NODE_LIMIT = 40;

const DRAW_WIDTH = 760;
const DRAW_HEIGHT = 648;
const DRAW_CX = 380;
const DRAW_CY = 322;
const INNER_RADIUS = 155;
const OUTER_RADIUS = 268;
/* The Founding 50 satellite is its own small SVG beside the main drawing —
   apart, the way it sits in the product, and droppable on a phone where the
   main rings need the full width. */
const SAT_WIDTH = 240;
const SAT_HEIGHT = 250;
const SATELLITE_X = 120;
const SATELLITE_Y = 140;
const SATELLITE_RADIUS = 90;

function polar(radius: number, angle: number): { x: number; y: number } {
  return {
    x: DRAW_CX + radius * Math.cos(angle),
    y: DRAW_CY + radius * Math.sin(angle),
  };
}

function drawnName(name: string): string {
  return name.length > 14 ? `${name.slice(0, 13)}…` : name;
}

/**
 * Contribution is the node: a member with published places is a filled disc
 * sized by how many, with the count printed inside; a member with none is a
 * small hollow ring. Who is actually contributing reads at a glance, without
 * hovering anyone.
 */
function nodeRadius(places: number): number {
  return places ? Math.min(24, 12 + places * 1.2) : 7;
}

function nodeMarkup(node: DrawnNode): string {
  const radius = nodeRadius(node.person.places);
  const filled = node.person.places > 0;
  return `<g class="circle-map-person" data-tip="${esc(personTitle(node.person, node.kind))}" data-circle-person="${esc(node.ref)}" role="button" tabindex="0" aria-haspopup="dialog" aria-label="${esc(`${personTitle(node.person, node.kind)} — open their places`)}">
    <circle class="circle-map-node${filled ? ' has-places' : ''} circle-map-node-${node.kind}" cx="${node.x.toFixed(1)}" cy="${node.y.toFixed(1)}" r="${radius}"></circle>
    ${
      filled
        ? `<text class="circle-map-node-count" x="${node.x.toFixed(1)}" y="${(node.y + 4.5).toFixed(1)}" text-anchor="middle">${node.person.places}</text>`
        : ''
    }
    <text class="circle-map-name" x="${node.x.toFixed(1)}" y="${(node.y + radius + 17).toFixed(1)}" text-anchor="middle">${esc(drawnName(node.person.name))}</text>
  </g>`;
}

function spokeMarkup(from: { x: number; y: number }, to: { x: number; y: number }, second: boolean): string {
  return `<line class="circle-map-spoke${second ? ' circle-map-spoke-second' : ''}" x1="${from.x.toFixed(1)}" y1="${from.y.toFixed(1)}" x2="${to.x.toFixed(1)}" y2="${to.y.toFixed(1)}"></line>`;
}

/**
 * The Founding 50 as a satellite: one small ring of exactly 50 seats, a dot
 * per seat, filled as they are taken — hovering a taken seat names the
 * member, in seating order. The centre reads as scarcity ("43 left"), not as
 * a tally of empty circles. Seats, not names: the cap is the shape.
 */
function satelliteMarkup(): string {
  const { cap, seated, members } = circle.founding;
  const taken = Math.max(seated, members.length);
  // The cap is policy; a boundary race could seat one member over it. Draw
  // whichever is larger so a taken seat is never silently dropped.
  const seats = Math.max(cap || 50, taken);
  const left = Math.max(0, seats - taken);
  let dots = '';
  for (let i = 0; i < seats; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / seats;
    const x = SATELLITE_X + SATELLITE_RADIUS * Math.cos(angle);
    const y = SATELLITE_Y + SATELLITE_RADIUS * Math.sin(angle);
    const dot = `<circle class="circle-map-seat${i < taken ? ' is-taken' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.4"></circle>`;
    // A taken seat is a person: the invisible wider circle is the hover pad —
    // a 3.4px dot is no hover target. The tip keeps to name, home, and
    // footprint: "Olga from Annecy, 2 places" — and clicking opens their
    // places like any other member of the circle.
    const seatTip = (person: CirclePerson): string =>
      `${person.name}${person.home ? ` from ${person.home}` : ''}, ${
        person.places ? placeCount(person.places) : 'no places yet'
      }`;
    dots +=
      i < taken && members[i]
        ? `<g class="circle-map-person" data-tip="${esc(seatTip(members[i]))}" data-circle-person="founding:${i}" role="button" tabindex="0" aria-haspopup="dialog" aria-label="${esc(`${seatTip(members[i])} — open their places`)}"><circle class="circle-map-hit" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9"></circle>${dot}</g>`
        : dot;
  }
  return `<svg class="circle-map-sat" viewBox="0 0 ${SAT_WIDTH} ${SAT_HEIGHT}" role="img" aria-label="Founding 50 — ${taken} of ${seats} seats taken.">
    <text class="circle-map-caption" x="${SATELLITE_X}" y="${SATELLITE_Y - SATELLITE_RADIUS - 16}" text-anchor="middle" data-tip="Founding members — every member can see their recommendations">Founding 50</text>
    ${dots}
    <text class="circle-map-sat-count" x="${SATELLITE_X}" y="${SATELLITE_Y + 2}" text-anchor="middle">${taken}</text>
    <text class="circle-map-sat-label" x="${SATELLITE_X}" y="${SATELLITE_Y + 24}" text-anchor="middle">${left ? `${left} left` : 'full'}</text>
  </svg>`;
}

function circleDrawingMarkup(): string {
  const { inviter, invited, secondDegree } = circle;
  const total = (inviter ? 1 : 0) + invited.length + secondDegree.length;
  if (!total) {
    return emptyNote('Nothing to draw yet — the rings appear with the first person in your circle.');
  }
  if (total > DRAWING_NODE_LIMIT) {
    return emptyNote('Your circle has grown past what one drawing can hold — switch to the list.');
  }

  // Inner ring: the inviter holds the top by construction; everyone the
  // member invited shares the rest of the ring evenly.
  const inner: DrawnNode[] = [];
  const innerCount = (inviter ? 1 : 0) + invited.length;
  const innerStep = innerCount ? (Math.PI * 2) / innerCount : 0;
  const topAngle = -Math.PI / 2;
  let slot = 0;
  if (inviter) {
    inner.push({
      person: inviter,
      ...polar(INNER_RADIUS, topAngle),
      angle: topAngle,
      kind: 'inviter',
      ref: 'inviter',
    });
    slot = 1;
  }
  const invitedNodes: DrawnNode[] = [];
  invited.forEach((person, index) => {
    const angle = topAngle + innerStep * slot;
    const node: DrawnNode = {
      person,
      ...polar(INNER_RADIUS, angle),
      angle,
      kind: 'invited',
      ref: `invited:${index}`,
    };
    inner.push(node);
    invitedNodes.push(node);
    slot += 1;
  });

  // Outer ring: each one-hop member fans out around the inner node that
  // connects them, so the spoke — the provenance line — stays short and
  // readable. Rows whose connector reference is missing still appear, spread
  // through the ring without a spoke.
  const connectorFor = (person: CirclePerson): DrawnNode | null => {
    if (person.connectorRef === 'inviter') return inviter ? inner[0] : null;
    const match = /^invited:(\d+)$/.exec(person.connectorRef || '');
    return match ? invitedNodes[Number(match[1])] || null : null;
  };
  const groups = new Map<DrawnNode, CirclePerson[]>();
  const orphans: CirclePerson[] = [];
  for (const person of secondDegree) {
    const anchor = connectorFor(person);
    if (anchor) groups.set(anchor, [...(groups.get(anchor) || []), person]);
    else orphans.push(person);
  }
  const outer: DrawnNode[] = [];
  const spokes: string[] = [];
  const sector = innerCount ? (Math.PI * 2) / innerCount : Math.PI * 2;
  const secondRef = (person: CirclePerson): string => `second:${secondDegree.indexOf(person)}`;
  for (const [anchor, people] of groups) {
    const step = Math.min(0.42, sector / Math.max(people.length, 1));
    people.forEach((person, index) => {
      const angle = anchor.angle + (index - (people.length - 1) / 2) * step;
      const node: DrawnNode = {
        person,
        ...polar(OUTER_RADIUS, angle),
        angle,
        kind: 'second',
        ref: secondRef(person),
      };
      outer.push(node);
      spokes.push(spokeMarkup(anchor, node, true));
    });
  }
  orphans.forEach((person, index) => {
    const angle = topAngle + ((index + 0.5) * (Math.PI * 2)) / orphans.length;
    outer.push({
      person,
      ...polar(OUTER_RADIUS, angle),
      angle,
      kind: 'second',
      ref: secondRef(person),
    });
  });

  const centre = { x: DRAW_CX, y: DRAW_CY };
  const innerSpokes = inner.map((node) => spokeMarkup(centre, node, false)).join('');
  const ringCaption = (radius: number, label: string): string => {
    const at = polar(radius, (-3 * Math.PI) / 4);
    return `<text class="circle-map-caption" x="${at.x.toFixed(1)}" y="${(at.y - 10).toFixed(1)}" text-anchor="middle">${esc(label)}</text>`;
  };
  return `<div class="circle-map">
    <svg class="circle-map-main" viewBox="0 0 ${DRAW_WIDTH} ${DRAW_HEIGHT}" role="img" aria-label="Your circle drawn as rings: you at the centre, ${innerCount} ${
      innerCount === 1 ? 'person' : 'people'
    } on the inner ring, ${secondDegree.length} one hop out on the outer ring. Spokes mark who invited whom; a filled node is sized by its member's published places.">
      <circle class="circle-map-ring circle-map-ring-inner" cx="${DRAW_CX}" cy="${DRAW_CY}" r="${INNER_RADIUS}"></circle>
      <circle class="circle-map-ring" cx="${DRAW_CX}" cy="${DRAW_CY}" r="${OUTER_RADIUS}"></circle>
      ${ringCaption(INNER_RADIUS, 'Your circle')}
      ${ringCaption(OUTER_RADIUS, 'One hop out')}
      ${innerSpokes}
      ${spokes.join('')}
      ${inner.map(nodeMarkup).join('')}
      ${outer.map(nodeMarkup).join('')}
      <circle class="circle-map-node circle-map-node-you" cx="${DRAW_CX}" cy="${DRAW_CY}" r="30"></circle>
      <text class="circle-map-you" x="${DRAW_CX}" y="${DRAW_CY + 5}" text-anchor="middle">You</text>
    </svg>
    ${satelliteMarkup()}
  </div>`;
}

/* ---------- slide-over panel ----------
   Clicking a person opens their published places in a panel over the graph —
   a tall narrow column from the right edge, the drawing dimmed but visible
   behind it, so closing feels like stepping back rather than navigating. On
   a phone the same component is a bottom sheet. Data comes from the circle
   places projection, addressed by positional reference; cards render through
   the shared grouped-recommendation renderer so a place reads the same here
   as on every other surface. */

function personByRef(ref: string): { person: CirclePerson; relation: CircleRelation | 'founding' } | null {
  if (ref === 'inviter') return circle.inviter ? { person: circle.inviter, relation: 'inviter' } : null;
  const match = /^(invited|second|founding):(\d+)$/.exec(ref);
  if (!match) return null;
  const index = Number(match[2]);
  const person =
    match[1] === 'invited'
      ? circle.invited[index]
      : match[1] === 'second'
        ? circle.secondDegree[index]
        : circle.founding.members[index];
  if (!person) return null;
  return {
    person,
    relation: match[1] === 'invited' ? 'invited' : match[1] === 'second' ? 'second' : 'founding',
  };
}

function cleanPanelItems(value: unknown): DiscoveryRecommendation[] {
  if (!Array.isArray(value)) return [];
  const items: DiscoveryRecommendation[] = [];
  for (const raw of value.slice(0, 100)) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const venueName = cleanText(row.venue_name, 200);
    if (!venueName) continue;
    items.push({
      venue_name: venueName,
      recommender_pseudo: cleanText(row.recommender_pseudo, 60),
      is_own: Boolean(row.is_own),
      founding_member: Boolean(row.founding_member),
      note: cleanText(row.note, 3000),
      city: cleanText(row.city, 120),
      country: cleanText(row.country, 120),
      address: cleanText(row.address, 300),
      created: cleanText(row.created, 40),
    });
  }
  return items;
}

async function loadPanelPlaces(ref: string, render: () => void): Promise<void> {
  const placesState: PanelPlacesState = { status: 'loading', isPrivate: false, items: [] };
  panelPlaces.set(ref, placesState);
  try {
    const payload = await pb.send<{ private?: unknown; items?: unknown }>(
      `/api/detour/circle/places?who=${encodeURIComponent(ref)}`,
      { requestKey: null }
    );
    placesState.isPrivate = Boolean(payload?.private);
    placesState.items = cleanPanelItems(payload?.items);
    placesState.status = 'ready';
  } catch {
    placesState.status = 'error';
  }
  if (panelRef === ref) render();
}

function openPanel(ref: string, render: () => void): void {
  panelRef = ref;
  const cached = panelPlaces.get(ref);
  if (!cached || cached.status === 'error') void loadPanelPlaces(ref, render);
  hideTip();
  render();
}

function closePanel(render: () => void): void {
  const ref = panelRef;
  const finish = () => {
    panelRef = null;
    render();
    // Closing steps back to the person it opened from.
    if (ref) {
      document
        .querySelector<HTMLElement | SVGElement>(`[data-circle-person="${ref}"]`)
        ?.focus({ preventScroll: true });
    }
  };
  // Mirror the entrance: slide the panel out (and let the content ease back)
  // before the node is actually removed on the next render.
  const panelEl = document.querySelector<HTMLElement>('[data-circle-panel]');
  if (panelEl && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (panelEl.classList.contains('is-closing')) return;
    panelEl.classList.add('is-closing');
    window.setTimeout(finish, 200);
  } else {
    finish();
  }
}

function panelMarkup(): string {
  if (!panelRef) return '';
  const found = personByRef(panelRef);
  if (!found) return '';
  const { person, relation } = found;
  const data = panelPlaces.get(panelRef);
  const meta = [person.home, person.places ? placeCount(person.places) : 'no places yet']
    .filter(Boolean)
    .join(' · ');
  const body =
    !data || data.status === 'loading'
      ? '<p class="circle-panel-status" role="status">Loading places…</p>'
      : data.status === 'error'
        ? '<div class="circle-panel-status is-error" role="alert"><p>Their places could not be loaded right now.</p><button class="secondary-button" type="button" data-circle-panel-retry>Try again</button></div>'
        : data.isPrivate
          ? `<p class="circle-panel-status">${esc(person.name)} keeps their recommendations private.</p>`
          : data.items.length
            ? `<div class="circle-panel-cards">${data.items
                .map((item) => groupedRecommendationCardMarkup([item], resolvePlaceFn))
                .join('')}</div>`
            : `<p class="circle-panel-status">${esc(person.name)} has no published places yet.</p>`;
  return `<div class="circle-panel-overlay" data-circle-panel-dismiss></div>
  <aside class="circle-panel" role="dialog" aria-modal="true" aria-label="${esc(`${person.name} — recommended places`)}" data-circle-panel>
    <header class="circle-panel-head" data-circle-panel-grip>
      <div>
        <p class="circle-panel-kicker">${esc(personSentence(person, relation))}</p>
        <h2>${esc(person.name)}</h2>
        ${meta ? `<p class="circle-panel-meta">${esc(meta)}</p>` : ''}
      </div>
      <button class="circle-panel-close" type="button" data-circle-panel-dismiss aria-label="Close">×</button>
    </header>
    <div class="circle-panel-body">${body}</div>
  </aside>`;
}

/** The page's one action. The allowance details live on the Invitations tab it opens. */
function allowanceMarkup(invitationsHref: string): string {
  return `<a class="secondary-button" href="${esc(invitationsHref)}" data-community-route="invitations">${
    circle.invitations.available ? 'Invite someone' : 'See your invitations'
  }</a>`;
}

export function circleMarkup(invitationsHref: string, resolvePlace?: NetworkPlaceResolver): string {
  resolvePlaceFn = resolvePlace;
  if (status === 'error') {
    return `<div class="circle-status is-error" role="alert">
      <p>${esc(errorMessage)}</p>
      <button class="secondary-button" type="button" data-circle-retry>Try again</button>
    </div>`;
  }
  if (status !== 'ready') {
    return '<p class="circle-status" role="status">Loading your circle…</p>';
  }
  // The spoke legend rides in the toolbar, on the same line as the view
  // switch — two words, and only when the rings are showing.
  const legend =
    view === 'rings'
      ? `<div class="circle-legend" aria-hidden="true">
          <span class="circle-legend-item"><span class="circle-legend-line"></span>invited</span>
          <span class="circle-legend-item"><span class="circle-legend-line is-second"></span>one hop</span>
        </div>`
      : '';
  return `<div class="circle-toolbar">
    <div class="circle-view-switch" role="group" aria-label="How to read your circle">
      <button class="circle-view-btn${view === 'rings' ? ' is-active' : ''}" type="button" data-circle-view="rings" aria-pressed="${view === 'rings'}">Rings</button>
      <button class="circle-view-btn${view === 'list' ? ' is-active' : ''}" type="button" data-circle-view="list" aria-pressed="${view === 'list'}">List</button>
    </div>
    ${legend}
    ${allowanceMarkup(invitationsHref)}
  </div>
  ${view === 'rings' ? circleDrawingMarkup() : listMarkup()}
  ${panelMarkup()}`;
}

/* ---------- instant tooltip ----------
   Native title tooltips sit behind an OS delay of about a second, which makes
   a page whose explanations all live on hover feel broken. One shared element
   follows the pointer instead: no delay, styled with the app, gone on leave.
   It lives on document.body so it survives full-page re-renders, and it is
   pointer-events: none so it never steals the hover that opened it. */

let tipElement: HTMLDivElement | null = null;

function tipEl(): HTMLDivElement {
  if (!tipElement) {
    tipElement = document.createElement('div');
    tipElement.className = 'circle-tip';
    tipElement.setAttribute('aria-hidden', 'true');
    tipElement.hidden = true;
    document.body.appendChild(tipElement);
  }
  return tipElement;
}

/**
 * Anchors the tip beside the hovered element, never over it: to the right of
 * its box, flipped to the left near the right edge, vertically centred and
 * clamped to the viewport. Wide targets (list rows, the toolbar button) get
 * the tip above instead — beside a full-width row means off-screen — flipped
 * below near the top. The tip does not follow the pointer: a steady position
 * beside the node is what keeps it from covering the drawing.
 */
function placeTip(el: Element, pointerX: number): void {
  const tip = tipEl();
  const rect = el.getBoundingClientRect();
  const pad = 10;
  const width = tip.offsetWidth;
  const height = tip.offsetHeight;
  let left: number;
  let top: number;
  if (rect.width < window.innerWidth / 2) {
    left = rect.right + pad;
    if (left + width > window.innerWidth - pad) left = rect.left - width - pad;
    top = rect.top + rect.height / 2 - height / 2;
  } else {
    left = pointerX - width / 2;
    top = rect.top - height - pad;
    if (top < pad) top = rect.bottom + pad;
  }
  tip.style.left = `${Math.max(pad, Math.min(left, window.innerWidth - width - pad))}px`;
  tip.style.top = `${Math.max(pad, Math.min(top, window.innerHeight - height - pad))}px`;
}

function hideTip(): void {
  if (tipElement) tipElement.hidden = true;
}

function bindTips(root: HTMLElement): void {
  hideTip();
  root.querySelectorAll<Element>('[data-tip]').forEach((el) => {
    const text = el.getAttribute('data-tip') || '';
    if (!text) return;
    el.addEventListener('mouseenter', (event) => {
      const tip = tipEl();
      tip.textContent = text;
      tip.hidden = false;
      placeTip(el, (event as MouseEvent).clientX);
    });
    el.addEventListener('mouseleave', hideTip);
  });
}

export function bindCircle(root: HTMLElement, render: () => void): void {
  ensureCircle(render);
  bindTips(root);
  latestRender = render;
  if (!panelDismissBound) {
    panelDismissBound = true;
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && panelRef && latestRender) closePanel(latestRender);
    });
  }
  root.querySelector<HTMLButtonElement>('[data-circle-retry]')?.addEventListener('click', () => {
    status = 'idle';
    loadedFor = '';
    void loadCircle(render);
  });
  root.querySelectorAll<HTMLButtonElement>('[data-circle-view]').forEach((button) => {
    button.addEventListener('click', () => {
      const next = button.dataset.circleView === 'list' ? 'list' : 'rings';
      if (next === view) return;
      view = next;
      render();
      // The whole page re-renders; put focus back on the control just used.
      root.querySelector<HTMLButtonElement>(`[data-circle-view="${next}"]`)?.focus({ preventScroll: true });
    });
  });

  // Every person — node, seat, or list row — opens their places panel.
  root.querySelectorAll<Element>('[data-circle-person]').forEach((el) => {
    const ref = el.getAttribute('data-circle-person') || '';
    if (!ref) return;
    const open = () => {
      openPanel(ref, render);
      root.querySelector<HTMLButtonElement>('.circle-panel-close')?.focus({ preventScroll: true });
    };
    el.addEventListener('click', open);
    el.addEventListener('keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      if (key === 'Enter' || key === ' ') {
        event.preventDefault();
        open();
      }
    });
  });
  root.querySelectorAll<HTMLElement>('[data-circle-panel-dismiss]').forEach((el) => {
    el.addEventListener('click', () => closePanel(render));
  });
  root.querySelector<HTMLButtonElement>('[data-circle-panel-retry]')?.addEventListener('click', () => {
    if (panelRef) void loadPanelPlaces(panelRef, render);
  });

  const panelEl = root.querySelector<HTMLElement>('[data-circle-panel]');
  const grip = root.querySelector<HTMLElement>('[data-circle-panel-grip]');
  // On a phone the panel is a bottom sheet: dragging its header down past a
  // threshold dismisses it; a shorter drag settles back.
  if (panelEl && grip) {
    let startY = 0;
    let delta = 0;
    let dragging = false;
    grip.addEventListener(
      'touchstart',
      (event) => {
        dragging = true;
        delta = 0;
        startY = event.touches[0]?.clientY ?? 0;
        panelEl.style.transition = 'none';
      },
      { passive: true }
    );
    grip.addEventListener(
      'touchmove',
      (event) => {
        if (!dragging) return;
        delta = Math.max(0, (event.touches[0]?.clientY ?? 0) - startY);
        panelEl.style.transform = `translateY(${delta}px)`;
      },
      { passive: true }
    );
    grip.addEventListener('touchend', () => {
      if (!dragging) return;
      dragging = false;
      panelEl.style.transition = '';
      // Clear the drag offset either way: on dismiss the is-closing slide
      // takes over from wherever the finger left off; otherwise settle back.
      panelEl.style.transform = '';
      if (delta > 90) closePanel(render);
      delta = 0;
    });
  }
}
