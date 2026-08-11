/**
 * LIVE DATA. Nothing on screen outlives the write that changed it.
 *
 * Every list on Detour is a server answer: the catalogue of published places, the
 * scoped circle feed that supplies every card's words, byline and photograph, the
 * member's own ledger, their saved places and their imported guides. None of them
 * can be reconstructed in the browser — the feed in particular is assembled
 * per-member by `/api/detour/network-discovery`, so what a write means for it is
 * only knowable by asking again.
 *
 * Two things are needed for a screen that is never stale, and this module is both:
 *
 * 1. **After every write, re-read everything.** `resyncAfterWrite` is the one call
 *    a write path makes, instead of each of them deciding for itself which of the
 *    five stores its write touched. That judgement was where the staleness came
 *    from: a new recommendation refreshed the ledger and the catalogue but not the
 *    feed, so the member's own sentence was missing from their own card; a sent
 *    share refreshed the ledger but not the feed, so it never joined the deck; a
 *    withdrawn Been & loved patched one venue object and left the rest.
 * 2. **While the screen is open, watch the database.** Everything above is about
 *    this member's own writes. The other members are writing too, and their
 *    recommendations become published places, seconds and covers — so the client
 *    subscribes to PocketBase's realtime stream and re-reads when a row it can see
 *    actually changes. A tab left open catches up on the way back to the front,
 *    and a browser that lost its connection catches up when it returns.
 *
 * The registry exists because the dependency has to point this way. main.ts holds
 * the catalogue and is the wiring layer; the feature modules that write are
 * imported by it. A refresh list written here as imports would close that loop, so
 * main.ts registers what it can refresh at boot and the write paths ask for a
 * resync without knowing what one consists of.
 */
import { pb } from './pocketbase';

type Refresh = (render: () => void) => Promise<void>;

const sources = new Map<string, Refresh>();

/**
 * Declare one server-backed store and how to re-read it.
 *
 * Registered by name, so registering twice replaces rather than duplicates, and a
 * refresh that throws is contained — one unavailable endpoint must not stop the
 * other four from catching up.
 */
export function registerLiveSource(name: string, refresh: Refresh): void {
  sources.set(name, refresh);
}

/**
 * Collections whose changes mean something on screen is now wrong.
 *
 * Scoped by PocketBase's own view rules, which is what makes subscribing safe:
 * the stream only ever carries rows this session could already read.
 *
 * `venues` is the public one and the one that does the work. A recommendation
 * publishes, seconds or withdraws a place through `recalculateAndPublish`, and
 * every one of those writes the venue row — so this single subscription is how one
 * member's new note reaches everybody else's screen, without anybody subscribing
 * to a collection of other people's recommendations (they could not: the rule on
 * `community_recommendations` is `member = @request.auth.id`).
 *
 * The member-scoped four are the other half: they carry what the server does to
 * this member's own rows after the request that started it has already answered —
 * a photo approved by a curator, a place enriched and published, a share or a
 * reply arriving from somebody else.
 */
const PUBLIC_COLLECTIONS = ['venues'] as const;
const MEMBER_COLLECTIONS = [
  'community_recommendations',
  'community_place_entries',
  'community_shares',
  'community_share_replies',
  // Scoped to codes this member issued or claimed, so this is how "somebody took
  // your invitation" reaches the circle page while it is open.
  'invites',
] as const;

/** Events inside this window become one re-read. */
const COALESCE_MS = 700;
/**
 * The floor between two event-driven re-reads. The nightly enrichment sweeps
 * update venues in bulk, and a screen that re-read five endpoints per row would
 * turn somebody else's maintenance into a denial of service against itself.
 */
const MIN_GAP_MS = 4000;
/**
 * How stale the data may be when a hidden tab comes back to the front before it is
 * re-read on sight. Below this, the events that arrived while it was hidden have
 * already been handled and there is nothing to do.
 */
const STALE_MS = 30_000;

let liveRender: (() => void) | null = null;
let unsubscribes: Array<() => void> = [];
let subscribedAs = '';
let windowListenersBound = false;
let timer = 0;
let lastSyncAt = 0;
let missedWhileHidden = false;
/** Tail of the queue of passes, so each new one starts after the last has finished. */
let chain: Promise<void> = Promise.resolve();
/** When the most recent unhandled realtime event arrived. */
let lastEventAt = 0;

/**
 * One pass: re-read every registered store, then render.
 *
 * `allSettled`, because these are independent reads and five of six succeeding is
 * five fewer things wrong on the screen. Each source is responsible for its own
 * failure behaviour, and all of them agree on it: a read that failed leaves what it
 * had, so nothing on screen is ever replaced by an absence.
 */
async function pass(render: () => void): Promise<void> {
  lastSyncAt = Date.now();
  await Promise.allSettled([...sources.values()].map((refresh) => refresh(render)));
  render();
}

/**
 * Queue a pass, and resolve when *that* pass is done.
 *
 * Serialised rather than concurrent, because two passes at once would race six
 * pairs of requests against each other and the loser would win. Queued rather than
 * joined, because a caller awaits this to learn what its own write did: handing it
 * a pass that started before the write would answer it with the state it was trying
 * to leave behind.
 */
function resync(render: () => void): Promise<void> {
  const next = chain.then(
    () => pass(render),
    () => pass(render)
  );
  chain = next.catch(() => {});
  return next;
}

/**
 * What a write path calls once it has saved something.
 *
 * Awaited, so the success notice a caller sets afterwards appears over data that
 * already agrees with it rather than a beat ahead of it.
 */
export async function resyncAfterWrite(render: () => void): Promise<void> {
  await resync(render);
}

/**
 * Re-read on the next quiet moment, because the database said something changed.
 *
 * Coalesced, floored and postponed while the tab is hidden — a background tab
 * neither needs the data nor should be spending the member's battery on it, and
 * the flag it leaves behind is what gets it re-read the moment they come back.
 */
function scheduleResync(): void {
  const render = liveRender;
  if (!render) return;
  lastEventAt = Date.now();
  if (document.hidden) {
    missedWhileHidden = true;
    return;
  }
  // One pending pass is enough: it will read the current state of everything,
  // including whatever arrives between now and when it runs.
  if (timer) return;
  const wait = Math.max(COALESCE_MS, MIN_GAP_MS - (Date.now() - lastSyncAt));
  timer = window.setTimeout(() => {
    timer = 0;
    // The member's own writes announce themselves twice: once by finishing, which
    // resyncs immediately, and once as an event a moment later. If a pass has
    // already read the database since this event was raised, it has read what the
    // event was telling us about, and running again would fetch six endpoints to
    // confirm what is already on screen.
    if (lastSyncAt > lastEventAt) return;
    void resync(render);
  }, wait);
}

function onVisible(): void {
  const render = liveRender;
  if (!render || document.hidden) return;
  if (!missedWhileHidden && Date.now() - lastSyncAt < STALE_MS) return;
  missedWhileHidden = false;
  void resync(render);
}

/**
 * Subscribe to the realtime stream and keep the screen current for as long as it
 * is open.
 *
 * Idempotent per session: called on boot and again whenever the session changes,
 * and a second call for the same member is a no-op rather than a second set of
 * subscriptions. A signed-out visitor gets the public subscription only, which is
 * all their surfaces are built from.
 *
 * Realtime is a best-effort layer over the reads, never a replacement for them: if
 * the stream cannot be established — an old browser, a proxy that buffers
 * server-sent events, a rule that refuses — the visibility and reconnect passes
 * still keep an open tab honest, and every write still re-reads on its own.
 */
export function startLiveUpdates(render: () => void): void {
  liveRender = render;
  const identity = pb.authStore.isValid ? pb.authStore.record?.id || '' : '';
  if (!windowListenersBound) {
    windowListenersBound = true;
    document.addEventListener('visibilitychange', onVisible);
    // Back from a dead connection: the stream reconnects itself, but the rows that
    // changed while it was down were never announced to anybody.
    window.addEventListener('online', () => {
      missedWhileHidden = true;
      onVisible();
    });
  }
  if (subscribedAs === (identity || '@anonymous') && unsubscribes.length) return;
  stopLiveSubscriptions();
  subscribedAs = identity || '@anonymous';
  const collections = identity ? [...PUBLIC_COLLECTIONS, ...MEMBER_COLLECTIONS] : [...PUBLIC_COLLECTIONS];
  for (const name of collections) {
    // The subscription is asynchronous and its handle arrives late, so what is
    // stored is a canceller that awaits the handle — otherwise a sign-out during the
    // handshake would leave behind a subscription nobody holds a way to drop.
    const handle = pb
      .collection(name)
      .subscribe('*', () => scheduleResync())
      .catch(() => null);
    unsubscribes.push(() => {
      void handle.then((unsubscribe) => unsubscribe?.());
    });
  }
}

function stopLiveSubscriptions(): void {
  for (const unsubscribe of unsubscribes) unsubscribe();
  unsubscribes = [];
  subscribedAs = '';
}

/**
 * Drop the stream and everything waiting on it. Called when the session ends: the
 * next member's subscriptions are their own, and a pending re-read belongs to the
 * member who was signed in when it was scheduled.
 */
export function stopLiveUpdates(): void {
  stopLiveSubscriptions();
  if (timer) {
    window.clearTimeout(timer);
    timer = 0;
  }
  missedWhileHidden = false;
  lastSyncAt = 0;
  lastEventAt = 0;
  // A pass already in flight belongs to the session that started it and cannot be
  // recalled — every source checks the signed-in identity across its own await for
  // that reason. What can be stopped is anything queued behind it.
  chain = Promise.resolve();
}
