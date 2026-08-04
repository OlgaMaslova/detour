/**
 * The preview card a place link shows when it is dropped into a chat.
 *
 * A member copies a place's URL and pastes it into WhatsApp or iMessage. What the
 * recipient sees before they tap anything is decided by the `og:` tags in the HTML
 * the crawler fetches — and crawlers do not run JavaScript, so everything the app
 * does to the document after boot is invisible to them. Served as plain static
 * assets, every URL on takedetour.app returns the same `index.html`, and so every
 * place previewed as "Detour — Places your network would actually recommend" with
 * the site's own social card. The place itself never appeared.
 *
 * This script exists to fix exactly that, for exactly one URL shape, and to get
 * out of the way otherwise:
 *
 *   - `wrangler.toml` sets `run_worker_first = ["/"]`, so only the bare root
 *     reaches this code. `/survey`, `/assets/*`, the favicon, the social card and
 *     the SPA fallback for unknown paths are served by the asset layer and never
 *     invoke it. That flag also switches off the `Sec-Fetch-Mode: navigate`
 *     preference for asset serving, which matters: without it a browser
 *     navigation would bypass this script while a crawler hit it, and the page a
 *     person opens would be built by a different path from the one that produced
 *     the card they tapped.
 *   - Anything that is not a place link — the home page included — is passed
 *     straight through to the assets untouched.
 *   - Any failure at all returns the untouched asset response. A richer preview
 *     is never worth a blank page.
 *
 * What it will not do: quote a member. The card is built from the place's own
 * facts, because a page a stranger can open is not the place for anybody's words
 * or pseudonym — the same rule `notesSection` follows in src/place.ts.
 */

import { citySlug, venuePlaceSlug } from '../src/slugs';
import type { SluggableVenue } from '../src/slugs';

interface Env {
  /** The static assets in `public/`, bound in wrangler.toml. */
  ASSETS: { fetch(request: Request): Promise<Response> };
}

/* HTMLRewriter is a Workers runtime global. Only the handful of members used
   below are declared, rather than pulling a types package in for four methods. */
interface RewriterElement {
  setAttribute(name: string, value: string): void;
  setInnerContent(content: string, options?: { html: boolean }): void;
  remove(): void;
}
interface Rewriter {
  on(selector: string, handlers: { element(element: RewriterElement): void }): Rewriter;
  transform(response: Response): Response;
}
declare const HTMLRewriter: { new (): Rewriter };

const SITE = 'https://takedetour.app';
const API = 'https://api.takedetour.app';

/** One page of the catalogue. PocketBase refuses more, and asking is one request. */
const PAGE_SIZE = 500;
/**
 * How many pages this will read before giving up. `venuePlaceSlug` disambiguates a
 * place against every other place in its city, so a truncated catalogue can resolve
 * a slug to the wrong record — which would put the wrong restaurant in somebody's
 * chat. Past this bound the card is abandoned rather than guessed at.
 */
const MAX_PAGES = 5;

/** The catalogue is public and changes slowly; ten minutes is plenty. */
const CATALOGUE_TTL_SECONDS = 600;

/** Exactly the fields the slug algorithm and the card need. */
const VENUE_FIELDS = 'id,name,city,country,category,disambiguator,image_url,curated_cover';

interface VenueRecord {
  id?: unknown;
  name?: unknown;
  city?: unknown;
  country?: unknown;
  category?: unknown;
  disambiguator?: unknown;
  image_url?: unknown;
  curated_cover?: unknown;
}

/** A place as this script needs it: sluggable, plus what goes on the card. */
interface PreviewPlace extends SluggableVenue {
  country: string;
  category: string;
  imageUrl: string;
  curatedCover: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const assets = () => env.ASSETS.fetch(request);
    const url = new URL(request.url);
    if (url.pathname !== '/') return assets();
    const city = text(url.searchParams.get('d')).toLowerCase();
    const place = text(url.searchParams.get('p')).toLowerCase();
    if (!city || !place) return assets();

    const response = await assets();
    // A redirect or an error from the asset layer is somebody else's business, and
    // rewriting a non-HTML body would corrupt it.
    if (!response.ok) return response;
    if (!(response.headers.get('content-type') || '').includes('text/html')) return response;

    // Everything from here in one guard, the rewrite included. This is the busiest
    // path on the site — the home page shares it — and a card is never worth a 500.
    try {
      const found = await resolvePlace(city, place);
      if (!found) return response;
      return withPlaceCard(response, found, city, place);
    } catch {
      return response;
    }
  },
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The published catalogue, read through the same public route the signed-out app
 * uses. Cached at the edge by URL, so a place link going round a group chat costs
 * one origin request between them rather than one each.
 */
async function loadCatalogue(): Promise<PreviewPlace[] | null> {
  const filter = encodeURIComponent('published = true && suppressed != true');
  const places: PreviewPlace[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const endpoint =
      `${API}/api/collections/venues/records` +
      `?page=${page}&perPage=${PAGE_SIZE}&skipTotal=1&filter=${filter}&fields=${VENUE_FIELDS}`;
    const response = await fetch(endpoint, {
      cf: { cacheTtl: CATALOGUE_TTL_SECONDS, cacheEverything: true },
    } as RequestInit);
    if (!response.ok) return null;
    const payload = (await response.json()) as { items?: VenueRecord[] };
    const items = Array.isArray(payload.items) ? payload.items : [];
    for (const record of items) {
      const place = fromRecord(record);
      if (place) places.push(place);
    }
    if (items.length < PAGE_SIZE) return places;
  }
  // Still full at the last page: the catalogue outgrew this reader. Say so rather
  // than resolve a slug against a partial city.
  return null;
}

function fromRecord(record: VenueRecord): PreviewPlace | null {
  const id = text(record.id);
  const name = text(record.name);
  const city = text(record.city);
  if (!id || !name || !city) return null;
  return {
    id,
    name,
    city,
    // The qualifier that tells two same-named places apart, read exactly as
    // venueFromRecord reads it in src/data.ts.
    neighborhood: text(record.disambiguator),
    country: text(record.country),
    category: text(record.category),
    imageUrl: text(record.image_url),
    curatedCover: text(record.curated_cover),
  };
}

/** Which published place, if any, this pair of slugs names. */
async function resolvePlace(city: string, place: string): Promise<PreviewPlace | null> {
  const catalogue = await loadCatalogue();
  if (!catalogue) return null;
  const inCity = catalogue.filter((entry) => citySlug(entry.city) === city);
  if (!inCity.length) return null;
  // Against the whole catalogue, not just the city: venuePlaceSlug does its own
  // city comparison, and handing it a pre-filtered list would change its answer.
  return inCity.find((entry) => venuePlaceSlug(entry, catalogue) === place) ?? null;
}

/**
 * The card itself. Composed from facts — what the place is and where it is — with
 * the one sentence that explains why it is on Detour at all, since that sentence
 * is the reason the link is worth opening.
 */
function cardCopy(place: PreviewPlace): { title: string; description: string } {
  const where = [place.city, place.country].filter(Boolean).join(', ');
  const opening = place.category ? `${place.category} in ${where}.` : `${where}.`;
  return {
    title: `${place.name}, ${place.city} — Detour`,
    description: `${opening} On Detour because a member went, loved it, and put their name behind it — no ads, no paid listings, no anonymous stars.`,
  };
}

/**
 * The place's own cover, absolute, or nothing.
 *
 * A curated file is served by the API at an exact 1200×630 crop, which is the size
 * the card wants. Otherwise the enrichment cover — the photograph from the place's
 * own website — is used at whatever size it happens to be. Never a member's
 * recommendation photo: a picture somebody attached to their note is theirs, and a
 * link preview is the last place it should surface.
 */
function cardImage(place: PreviewPlace): { url: string; exactSize: boolean } | null {
  if (place.curatedCover) {
    return {
      url: `${API}/api/files/venues/${encodeURIComponent(place.id)}/${encodeURIComponent(
        place.curatedCover
      )}?thumb=1200x630`,
      exactSize: true,
    };
  }
  if (/^https?:\/\//i.test(place.imageUrl)) return { url: place.imageUrl, exactSize: false };
  return null;
}

/** Rewrite the head of the served document to describe this place. */
function withPlaceCard(
  response: Response,
  place: PreviewPlace,
  city: string,
  slug: string
): Response {
  const { title, description } = cardCopy(place);
  // Rebuilt from the resolved slugs rather than echoed from the request, so no
  // extra parameter a link picked up on its travels can end up asserted as this
  // page's canonical address.
  const canonical = `${SITE}/?d=${encodeURIComponent(city)}&p=${encodeURIComponent(slug)}`;
  const image = cardImage(place);
  const alt = `${place.name} — ${place.city}`;

  const set = (attribute: string, value: string) => ({
    element(element: RewriterElement) {
      element.setAttribute(attribute, value);
    },
  });
  const drop = { element: (element: RewriterElement) => element.remove() };

  let rewriter = new HTMLRewriter()
    .on('title', {
      element(element) {
        element.setInnerContent(title);
      },
    })
    .on('meta[name="description"]', set('content', description))
    .on('link[rel="canonical"]', set('href', canonical))
    .on('meta[property="og:title"]', set('content', title))
    .on('meta[property="og:description"]', set('content', description))
    .on('meta[property="og:url"]', set('content', canonical))
    .on('meta[name="twitter:title"]', set('content', title))
    .on('meta[name="twitter:description"]', set('content', description));

  // With no cover, every image tag in the document already describes the site card
  // it still points at, and is left exactly as it is.
  if (image) {
    rewriter = rewriter
      .on('meta[property="og:image"]', set('content', image.url))
      .on('meta[property="og:image:alt"]', set('content', alt))
      .on('meta[name="twitter:image"]', set('content', image.url))
      .on('meta[name="twitter:image:alt"]', set('content', alt))
      // The declared type belonged to the site card's PNG; the API serves whatever
      // format was uploaded, and a wrong type is worse than none.
      .on('meta[property="og:image:type"]', drop);
    if (!image.exactSize) {
      // An external photograph of unknown dimensions. Asserting 1200×630 about it
      // would have the messaging app lay out a card for an image that is not that
      // shape.
      rewriter = rewriter
        .on('meta[property="og:image:width"]', drop)
        .on('meta[property="og:image:height"]', drop);
    }
  }

  const transformed = rewriter.transform(response);
  const headers = new Headers(transformed.headers);
  // Short and shared: a card is worth caching for a chat thread's worth of taps,
  // not for the life of the place. The cache key includes the query string, so one
  // place's card can never be served for another.
  headers.set('cache-control', 'public, max-age=60');
  return new Response(transformed.body, {
    status: transformed.status,
    statusText: transformed.statusText,
    headers,
  });
}
