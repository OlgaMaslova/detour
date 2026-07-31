import { pb } from './pocketbase';
import { ensureInvitationLink, openInvitationLink } from './community';
import { groupedRecommendationCardMarkup } from './network';
import { bindInviteShare, inviteShareMarkup } from './share';
import type { DiscoveryRecommendation, NetworkPlaceResolver } from './network';

/**
 * My Circle — the invitation graph the signed-in member belongs to.
 *
 * Detour only grows by personal invitation, so this is the trust structure of
 * the app made legible: who brought you in, who you brought in, and who is one
 * invitation further out with the connecting member named on the row. Only
 * relational rows appear — anything that reads the same for every member says
 * nothing about the caller's own circle and has no place here.
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
}

const EMPTY: CircleData = {
  invitations: { limit: 0, unclaimed: 0, available: 0 },
  inviter: null,
  invited: [],
  secondDegree: [],
};

/** The drawing is the page; the list is the alternative reading of it. */
type CircleView = 'rings' | 'list';

let status: CircleStatus = 'idle';
let loadedFor = '';
let errorMessage = '';
let circle: CircleData = EMPTY;
let view: CircleView = 'rings';

/** The invite button's own small state machine, reset once the copy has been read. */
type InviteLinkState = 'idle' | 'working' | 'copied' | 'error';
let inviteLink: InviteLinkState = 'idle';
let inviteLinkTimer = 0;
/* An already-open invitation, fetched when the circle loads. Browsers only trust
   a clipboard write that starts in the click's own task, so the link the member
   most likely wants is in hand before they ask for it; only a member with no open
   code pays a round-trip on the click. */
let inviteReady: string | null = null;

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
  return {
    invitations: {
      limit: cleanCount(invitations.limit),
      unclaimed: cleanCount(invitations.unclaimed),
      available: cleanCount(invitations.available),
    },
    inviter: cleanPerson(payload.inviter),
    invited: cleanPeople(payload.invited),
    secondDegree: cleanPeople(payload.second_degree),
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
    if (circle.invitations.unclaimed && !inviteReady) void primeInviteLink();
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
  window.clearTimeout(inviteLinkTimer);
  inviteLink = 'idle';
  inviteReady = null;
}

/**
 * Re-reads the projection in place after a code is created, so the allowance line
 * under the button stays true. Deliberately quiet: no 'loading' status, because
 * the page is already drawn and only three numbers are changing.
 */
async function refreshInvitations(render: () => void): Promise<void> {
  const identity = memberId();
  if (!identity) return;
  try {
    const payload = await pb.send<unknown>('/api/detour/circle', { requestKey: null });
    if (memberId() !== identity) return;
    circle = cleanPayload(payload);
    render();
  } catch {
    // The counts stay as they were; the server is still the guard.
  }
}

/** Best effort: a failure here just means the click does the work instead. */
async function primeInviteLink(): Promise<void> {
  try {
    inviteReady = await openInvitationLink();
  } catch {
    inviteReady = null;
  }
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
function personSentence(person: CirclePerson, relation: CircleRelation): string {
  return relation === 'inviter'
    ? `${person.name} invited you`
    : relation === 'invited'
      ? `You invited ${person.name}`
      : `${person.connector || 'A member'} invited ${person.name}`;
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
 * Two tight lines on the left — name, then geography and footprint in small mono
 * — and one action on the right: share a place with this person. The person block
 * is the panel trigger and the share link is its sibling, never nested inside it:
 * one interactive control may not contain another, and a click on Share must not
 * also open the panel behind it.
 *
 * The footprint used to ride the right edge as a bare number; across a full-width
 * row it sat an inch of empty ground from its name and read as unlabelled, so the
 * meta line says "4 cities · 8 places" in words instead.
 */
function personRow(
  person: CirclePerson,
  relation: CircleRelation,
  ref: string,
  memberHref: string
): string {
  return `<li class="circle-person">
    <div class="circle-person-main" data-circle-person="${esc(ref)}" role="button" tabindex="0" aria-haspopup="dialog" aria-label="${esc(`${personSentence(person, relation)} — open their places`)}">
      <span class="circle-person-name">${esc(person.name)}${
        relation === 'second' && person.connector
          ? ` <span class="circle-person-provenance">· invited by ${esc(person.connector)}</span>`
          : ''
      }</span>
      <span class="circle-person-meta">${esc(personGeography(person))}</span>
    </div>
    <a class="circle-person-share" href="${esc(memberHref)}" data-community-route="share-place" data-share-recipient="${esc(person.name)}" aria-label="${esc(`Share a place with ${person.name}`)}">Share a place</a>
  </li>`;
}

function emptyNote(text: string): string {
  return `<p class="circle-empty">${esc(text)}</p>`;
}

/**
 * The list view: one ruled list, tiny group labels, one line per person. Rows
 * carry a share link, so the member-area href travels down with them.
 */
function listMarkup(memberHref: string): string {
  const { inviter, invited, secondDegree } = circle;
  const allGroups: { label: string; relation: CircleRelation; refPrefix: string; people: CirclePerson[] }[] = [
    { label: 'Your inviter', relation: 'inviter', refPrefix: 'inviter', people: inviter ? [inviter] : [] },
    { label: `You invited · ${invited.length}`, relation: 'invited', refPrefix: 'invited', people: invited },
    { label: `Friends of friends · ${secondDegree.length}`, relation: 'second', refPrefix: 'second', people: secondDegree },
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
              group.refPrefix === 'inviter' ? 'inviter' : `${group.refPrefix}:${index}`,
              memberHref
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
  return `<div class="circle-map">
    <svg class="circle-map-main" viewBox="0 0 ${DRAW_WIDTH} ${DRAW_HEIGHT}" role="img" aria-label="Your circle drawn as rings: you at the centre, ${innerCount} ${
      innerCount === 1 ? 'person' : 'people'
    } on the inner ring, ${secondDegree.length} friends of friends on the outer ring. Spokes mark who invited whom; a filled node is sized by its member's published places.">
      <circle class="circle-map-ring circle-map-ring-inner" cx="${DRAW_CX}" cy="${DRAW_CY}" r="${INNER_RADIUS}"></circle>
      <circle class="circle-map-ring" cx="${DRAW_CX}" cy="${DRAW_CY}" r="${OUTER_RADIUS}"></circle>
      ${innerSpokes}
      ${spokes.join('')}
      ${inner.map(nodeMarkup).join('')}
      ${outer.map(nodeMarkup).join('')}
      <circle class="circle-map-node circle-map-node-you" cx="${DRAW_CX}" cy="${DRAW_CY}" r="30"></circle>
      <text class="circle-map-you" x="${DRAW_CX}" y="${DRAW_CY + 5}" text-anchor="middle">You</text>
    </svg>
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

function personByRef(ref: string): { person: CirclePerson; relation: CircleRelation } | null {
  if (ref === 'inviter') return circle.inviter ? { person: circle.inviter, relation: 'inviter' } : null;
  const match = /^(invited|second):(\d+)$/.exec(ref);
  if (!match) return null;
  const index = Number(match[2]);
  const person = match[1] === 'invited' ? circle.invited[index] : circle.secondDegree[index];
  if (!person) return null;
  return { person, relation: match[1] === 'invited' ? 'invited' : 'second' };
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

/**
 * One line of arithmetic before the drawing: how many people the circle holds
 * — inviter, invited, and one hop out, the same rows the drawing and the list
 * show.
 */
function summaryMarkup(): string {
  const { inviter, invited, secondDegree } = circle;
  const total = (inviter ? 1 : 0) + invited.length + secondDegree.length;
  if (!total) return '';
  return `<p class="circle-summary">${total} ${total === 1 ? 'Detourist' : 'Detourists'} in my circle</p>`;
}

/**
 * Why this page is worth reading: the circle is also the reach of the list.
 * A member's recommendations come from the people drawn here and from the
 * founding members — so the graph explains what shows up everywhere else. Kept
 * to a few lines beside the drawing, in the small print register.
 *
 * This claim is enforced, not decorative. The same five relational branches this
 * page is drawn from are the filter on every read path that returns
 * member-authored content — see visibleRecommenderSql in
 * pb_hooks/circle_scope.js. Two things it deliberately does not claim: a place
 * someone sends you privately reaches your inbox whatever the distance, and the
 * occasion tags on a place are shared by everyone who recommended it.
 */
function visibilityNoteMarkup(): string {
  return `<aside class="circle-note">
    <p class="circle-note-title">What you can see</p>
    <p>Recommendations reach you from this circle only — the members drawn here — plus every founding member. Nobody else's places show up on your list. A place someone sends you privately still arrives, wherever they are.</p>
  </aside>`;
}

/**
 * The page's one action: the invite link, straight to the clipboard. Growing the
 * circle is what this page is for, so it happens here rather than on another tab
 * — a member with nothing left to give still gets the way through to their
 * invitations, where the allowance is explained. It leads the page under the
 * headcount, above the view switch, so it reads the same in both views.
 */
function allowanceMarkup(invitationsHref: string): string {
  const { limit, available, unclaimed } = circle.invitations;
  const control =
    !available && !unclaimed
      ? `<a class="secondary-button" href="${esc(invitationsHref)}" data-community-route="invitations">See your invitations</a>`
      : `<button class="secondary-button" type="button" data-circle-invite aria-live="polite"${
          inviteLink === 'working' ? ' disabled' : ''
        }>${
          inviteLink === 'working'
            ? 'Preparing link…'
            : inviteLink === 'copied'
              ? 'Link copied'
              : inviteLink === 'error'
                ? 'Try again'
                : 'Copy an invite link'
        }</button>`;
  // One number beside the button, straight from the server's count: how many
  // invitations are left to hand out. It is also why the button reads the way it
  // does — at none left, the control becomes the way through to the allowance.
  const note = limit
    ? `<p class="circle-allowance-note">${available ? `${available} to give` : 'none left to give'}</p>`
    : '';
  // Once a link is in hand — primed on load, or created by the copy above — the
  // ways to send it sit beside the button, so the errand finishes on this page.
  return `<div class="circle-allowance">${control}${note}${inviteReady ? inviteShareMarkup(inviteReady) : ''}</div>`;
}

/**
 * The whole page below the hero. `memberHref` is the member area's own URL: both
 * the invitation link and every row's share link point at it, and the route
 * handler decides which form opens.
 */
export function circleMarkup(memberHref: string, resolvePlace?: NetworkPlaceResolver): string {
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
  // The spoke legend rides in the toolbar, on the same line as the view switch —
  // two words, and only when the rings are showing. Its box is rendered either
  // way: it holds the toolbar's centre column, and the drawing below is centred
  // on the same axis, so legend and rings share one vertical line.
  const legend =
    view === 'rings'
      ? `<span class="circle-legend-item"><span class="circle-legend-line"></span>invited</span>
         <span class="circle-legend-item"><span class="circle-legend-line is-second"></span>friend of a friend</span>`
      : '';
  return `<header class="circle-lead">
    ${summaryMarkup()}
    ${allowanceMarkup(memberHref)}
  </header>
  <div class="circle-toolbar">
    <div class="circle-view-switch" role="group" aria-label="How to read your circle">
      <button class="circle-view-btn${view === 'rings' ? ' is-active' : ''}" type="button" data-circle-view="rings" aria-pressed="${view === 'rings'}">Rings</button>
      <button class="circle-view-btn${view === 'list' ? ' is-active' : ''}" type="button" data-circle-view="list" aria-pressed="${view === 'list'}">List</button>
    </div>
    <div class="circle-legend" aria-hidden="true">${legend}</div>
  </div>
  <div class="circle-body${view === 'list' ? ' is-list' : ''}">
    ${visibilityNoteMarkup()}
    <div class="circle-body-main">${view === 'rings' ? circleDrawingMarkup() : listMarkup(memberHref)}</div>
  </div>
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
  bindInviteShare(root);
  latestRender = render;
  if (!panelDismissBound) {
    panelDismissBound = true;
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && panelRef && latestRender) closePanel(latestRender);
    });
  }
  // One click does the whole errand: prepare a code if none is open, then put the
  // link on the clipboard. The button itself reports what happened and settles
  // back to its resting label, so the page needs no notice bar.
  root.querySelector<HTMLButtonElement>('[data-circle-invite]')?.addEventListener('click', async () => {
    if (inviteLink === 'working') return;
    window.clearTimeout(inviteLinkTimer);
    inviteLink = 'working';
    render();
    const hadLink = Boolean(inviteReady);
    try {
      // render() above is synchronous, so with a primed link the write still
      // begins inside the click's own task — the only form Safari accepts.
      if (inviteReady) {
        await navigator.clipboard.writeText(inviteReady);
      } else {
        const link = await ensureInvitationLink();
        inviteReady = link;
        await navigator.clipboard.writeText(link);
      }
      inviteLink = 'copied';
    } catch {
      inviteLink = 'error';
    }
    // A code may have been spent to serve that click: re-read the counts.
    if (!hadLink && inviteLink === 'copied') void refreshInvitations(render);
    render();
    // The render replaced the button; put focus back on the new one.
    document.querySelector<HTMLButtonElement>('[data-circle-invite]')?.focus({ preventScroll: true });
    inviteLinkTimer = window.setTimeout(() => {
      inviteLink = 'idle';
      // Only redraw if the button is still on screen: a stray re-render of
      // whatever page the member moved on to could discard what they were typing.
      if (document.querySelector('[data-circle-invite]')) render();
    }, 2400);
  });
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
