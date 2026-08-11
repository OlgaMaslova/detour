/// <reference path="../pb_data/types.d.ts" />
//
// Imported lists — reading a published list of places off its own page, and
// holding the result privately for the member who pasted the link.
//
// A module, not a hook file: nothing here registers anything (the routes live in
// guides.pb.js). PocketBase runs every hook callback in its own VM, so
// every function here must be reached through a `require()` made INSIDE the
// callback that uses it.
//
// See docs/guides-spec.md.
//
// THREE READERS, IN THIS ORDER, and the order is the whole design:
//
//   json_ld     the page's own machine-readable ItemList     exact, free
//   structured  headings with an address or a neighbourhood  exact, free
//   model       OpenAI over the page's text                   costs, can invent
//
// Publications that care about being indexed ship JSON-LD, and Eater's map pages
// do; that path is exact, costs nothing, and cannot name a restaurant the page
// does not. The model runs only when both free readers came back empty, which is
// what keeps "or similar" working without putting a paid call and a hallucination
// risk on the common path. `read_by` on the list records which one fired, so it
// is possible to tell whether the fallback is carrying sites it should not
// have to.
//
// WHAT IS EXTRACTED, AND WHAT IS NOT. A name, a neighbourhood, an address, at
// most one sentence of the publication's own copy, and the address of their
// photograph.
//
// THE PHOTOGRAPH IS HOTLINKED, NEVER COPIED. Nothing is fetched, stored or
// re-served: the card points at the publisher's URL and the member's browser
// asks them for it, which is the difference between linking to a photograph and
// reproducing one. A publisher who does not want that blocks it at their end and
// the card falls back to the monogram every card already has. It is never
// promoted onto a `venues.image_url` — Detour's own covers are separately
// resolved and verified, and a private row must not put somebody else's
// photograph on a public catalogue page.
//
// No rank or position: a list read here is a set of places the member might
// want, not a chart, and storing "number 3 of 38" would import exactly the
// ranking this product exists in opposition to.
//
// NOTHING HERE IS EVER COMPUTED FOR ANOTHER MEMBER. Same rule as Wanna go, which
// these places sit on: no count of how many members imported a place, no
// projection, no notification to the recommender of a place that matched. The
// test to apply to any change: could a member learn anything at all about another
// member's imports, including that they exist?

/** A page naming more than this is an index or an archive, not a list. */
const MAX_LIST_PLACES = 100;
/**
 * Enough markup for a long map page, and far short of a whole news site.
 *
 * Sized against the real thing rather than guessed: Eater's thirty-eight-place
 * map page is 2.5MB of markup, with its last heading past the two-million mark.
 * A smaller cap does not fail loudly — it silently returns the first six places
 * and calls that the list.
 */
const MAX_BODY_SCAN = 3000000;
/**
 * How much of a section is searched for the facts belonging to its heading.
 *
 * Also sized against the real thing: the sections on that page are roughly 50KB
 * apart, most of it inlined image markup. The scan stops at the next heading
 * anyway, so this is a ceiling rather than a window.
 */
const MAX_BLOCK_SCAN = 120000;
/** How much page text the model reader is given. */
const MAX_MODEL_TEXT = 60000;
/** Below this, a page with headings is a page, not a list of places. */
const MIN_STRUCTURED_PLACES = 3;
/** A place with an address that will not geocode is retried at most weekly. */
const LOCATE_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A publication's server may answer an unrecognised agent with a consent wall or
 * nothing at all, and the request being made is one a member just pasted, on
 * their behalf, once. The rest of this codebase introduces itself where the
 * service it calls asks to be introduced to (Nominatim) and presents a browser
 * where the service only answers browsers (Google's short links); this is the
 * second case.
 */
const READ_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Headings that are furniture on every article, never a place. */
const NON_PLACE_HEADINGS = [
  "share",
  "share this story",
  "related",
  "more from",
  "most read",
  "sign up",
  "newsletter",
  "comments",
  "follow",
  "advertisement",
  "read more",
  "see all",
  "next up",
  "in this article",
  "table of contents",
  "how we chose",
  "about this list",
  "contents",
  "footer",
  "menu",
  "search",
  "subscribe",
];

/** Street words that make a numbered text run an address rather than a price. */
const STREET_WORDS =
  "street|st|avenue|ave|road|rd|boulevard|blvd|broadway|place|pl|lane|ln|drive|dr|" +
  "way|square|sq|court|ct|terrace|highway|hwy|parkway|pkwy|circle|alley|walk|" +
  "rue|avenida|calle|carrer|via|viale|corso|piazza|strada|straße|strasse|gasse|" +
  "platz|weg|allee|laan|straat|gade|gatan|katu";

/* ---------- the pasted link ---------- */

/**
 * The pasted value as a URL worth fetching, or "".
 *
 * The same public-host guard the cover fetcher applies, for the same reason: this
 * is a server-side GET at an address a member controls, so a bare hostname, an
 * IP, or anything resolving inside the network is refused before it is sent.
 */
function listPageUrl(value) {
  const raw = String(value === undefined || value === null ? "" : value).trim();
  if (!raw || raw.length > 2048) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
  const match = withScheme.match(/^(https?):\/\/([^/?#]+)([/?#].*)?$/i);
  if (!match) return "";
  const authority = match[2];
  if (authority.indexOf("@") !== -1 || authority.indexOf("[") !== -1) return "";
  const host = authority.split(":")[0].toLowerCase();
  if (!host) return "";
  if ($os.getenv("DETOUR_COVER_ALLOW_PRIVATE_HOSTS") !== "1") {
    if (
      host.indexOf(".") === -1 ||
      /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
      host === "localhost" ||
      /\.(localhost|local|internal|flycast)$/.test(host)
    ) {
      return "";
    }
  }
  return withScheme;
}

/** The page's markup, capped, or "". Never throws: an unreadable link is a no. */
function fetchListPage(url) {
  let response;
  try {
    response = $http.send({
      url,
      method: "GET",
      headers: {
        "User-Agent": READ_USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en",
      },
      timeout: 20,
    });
  } catch {
    return "";
  }
  if (!response || response.statusCode < 200 || response.statusCode >= 300) return "";
  // `raw`, not `body`: PocketBase's response exposes the decoded text there, and
  // `body` is bytes — String()ing those yields a comma-separated list of numbers
  // that every reader below silently finds nothing in.
  return String(response.raw || "").slice(0, MAX_BODY_SCAN);
}

/* ---------- markup to text ---------- */

function decodeEntities(value) {
  return String(value || "")
    .replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (whole, dec, hex, name) => {
      if (dec) return String.fromCharCode(parseInt(dec, 10));
      if (hex) return String.fromCharCode(parseInt(hex, 16));
      const named = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: " ",
        rsquo: "’",
        lsquo: "‘",
        rdquo: "”",
        ldquo: "“",
        mdash: "—",
        ndash: "–",
        hellip: "…",
        eacute: "é",
        egrave: "è",
        agrave: "à",
        ccedil: "ç",
        ouml: "ö",
        uuml: "ü",
        auml: "ä",
        ntilde: "ñ",
      };
      return Object.prototype.hasOwnProperty.call(named, name.toLowerCase())
        ? named[name.toLowerCase()]
        : whole;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** Drops scripts, styles and tags, leaving readable text. */
function textOf(markup) {
  return decodeEntities(
    String(markup || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " ")
  );
}

/* ---------- reader 1: the page's own JSON-LD ---------- */

/** Every JSON-LD object on the page, flattened through `@graph`. */
function jsonLdObjects(html) {
  const found = [];
  const pattern =
    /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    let parsed;
    try {
      // Some publications emit a trailing comma or an HTML comment wrapper.
      parsed = JSON.parse(String(match[1]).replace(/^\s*<!--/, "").replace(/-->\s*$/, ""));
    } catch {
      continue;
    }
    const queue = Array.isArray(parsed) ? parsed.slice() : [parsed];
    while (queue.length) {
      const item = queue.shift();
      if (!item || typeof item !== "object") continue;
      if (Array.isArray(item)) {
        for (const entry of item) queue.push(entry);
        continue;
      }
      found.push(item);
      if (Array.isArray(item["@graph"])) {
        for (const entry of item["@graph"]) queue.push(entry);
      }
    }
  }
  return found;
}

function typesOf(node) {
  const raw = node && (node["@type"] || node.type);
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter(Boolean).map((value) => String(value).toLowerCase());
}

const PLACE_TYPES = [
  "restaurant",
  "localbusiness",
  "foodestablishment",
  "cafeorcoffeeshop",
  "bakery",
  "barorpub",
  "nightclub",
  "winery",
  "brewery",
  "icecreamshop",
  "place",
  "fooddeliveryservice",
];

/**
 * What kind of place the publication said this is.
 *
 * READ, NEVER GUESSED. Both answers come out of the page's own structured data:
 * the schema.org type it declared, and `servesCuisine` where it named one. A
 * page with no structured data goes through the heading scraper and gets
 * nothing — a category inferred from the word "croissant" would be Detour
 * asserting something nobody asserted, on a place nobody has stood behind.
 *
 * The cuisine outranks the bare type, and only the bare type: a Georgian
 * restaurant is `ethnic_cuisine` because that is the useful fact, while a
 * Georgian bakery is a bakery — the narrower type is what a member is scanning
 * for. The word itself is kept either way, because a row that says "Georgian"
 * beats one that says "Ethnic cuisine".
 */
const SCHEMA_CATEGORIES = {
  bakery: "bakery",
  cafeorcoffeeshop: "cafe",
  barorpub: "bar",
  nightclub: "bar",
  winery: "wine_bar",
  brewery: "brewery",
  icecreamshop: "ice_cream",
  fooddeliveryservice: "takeaway",
  restaurant: "restaurant",
  foodestablishment: "restaurant",
};

function categoryFromNode(node) {
  let category = "";
  for (const type of typesOf(node)) {
    const mapped = SCHEMA_CATEGORIES[type];
    // The first recognised type wins, but a specific one replaces the general
    // `Restaurant` a page often lists alongside it.
    if (mapped && (!category || category === "restaurant")) category = mapped;
  }
  const cuisine = cuisineFromNode(node);
  if (cuisine && (!category || category === "restaurant")) category = "ethnic_cuisine";
  return { category, cuisine };
}

/**
 * The category options an imported place may carry: the same closed set the
 * catalogue's three collections use, and nothing else. See
 * 1787097600_imported_place_category.js.
 *
 * It lives here rather than beside the route that writes it because a route
 * callback runs in its own VM and can see nothing this file's siblings declared
 * at their top level — only what it required.
 */
const IMPORTED_CATEGORIES = [
  "restaurant",
  "ethnic_cuisine",
  "cafe",
  "bakery",
  "bar",
  "cocktail_bar",
  "wine_bar",
  "brewery",
  "food_market",
  "deli",
  "dessert_shop",
  "ice_cream",
  "takeaway",
  "other",
];

/** A category from that set, or "" — anything the app cannot render is dropped. */
function importedCategory(value) {
  const category = String(value || "").trim();
  return IMPORTED_CATEGORIES.indexOf(category) === -1 ? "" : category;
}

/** `servesCuisine`, as one word. A string, or the first of a list of them. */
function cuisineFromNode(node) {
  const raw = node.servesCuisine;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return "";
  const cleaned = decodeEntities(value).trim();
  // A sentence rather than a cuisine — some pages put prose in this field, and
  // "Modern American cooking with a seasonal bent" is not a label for a row.
  if (!cleaned || cleaned.length > 40 || cleaned.indexOf(",") !== -1) return "";
  return cleaned;
}

function isPlaceNode(node) {
  const types = typesOf(node);
  for (const type of types) {
    if (PLACE_TYPES.indexOf(type) !== -1) return true;
  }
  return false;
}

/**
 * A schema.org `image`, as one URL.
 *
 * Three shapes in the wild and all three appear on real pages: a bare URL
 * string, an array of them, and an ImageObject with a `url`. Whatever comes back
 * is only ever pointed at, never fetched — see the field's own note in the
 * migration.
 */
function imageFromNode(node) {
  let value = node && (node.image || node.thumbnailUrl);
  if (Array.isArray(value)) value = value[0];
  if (value && typeof value === "object") value = value.url || value.contentUrl || "";
  return publicImageUrl(value);
}

/**
 * A claimed image address as something safe to put in an `src`, or "".
 *
 * The same public-host guard the page fetch applies, for the same reason: this
 * URL ends up in markup the member's browser will request. No round trip is made
 * to confirm it serves an image — thirty-eight HEAD requests inside one import
 * would cost more than the covers are worth, and a dead one degrades to the
 * monogram the card already has.
 */
function publicImageUrl(value) {
  const raw = String(value === undefined || value === null ? "" : value).trim();
  if (!raw || raw.length > 2048) return "";
  if (!/^https?:\/\//i.test(raw)) return "";
  const match = raw.match(/^(https?):\/\/([^/?#]+)([/?#].*)?$/i);
  if (!match) return "";
  const authority = match[2];
  if (authority.indexOf("@") !== -1 || authority.indexOf("[") !== -1) return "";
  const host = authority.split(":")[0].toLowerCase();
  if (!host) return "";
  if ($os.getenv("DETOUR_COVER_ALLOW_PRIVATE_HOSTS") !== "1") {
    if (
      host.indexOf(".") === -1 ||
      /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
      host === "localhost" ||
      /\.(localhost|local|internal|flycast)$/.test(host)
    ) {
      return "";
    }
  }
  return raw;
}

/** A schema.org PostalAddress, or a plain string address, as one line. */
function addressFromNode(node) {
  const address = node && (node.address || node.location);
  if (!address) return { street: "", city: "", country: "" };
  if (typeof address === "string") {
    return { street: decodeEntities(address), city: "", country: "" };
  }
  if (Array.isArray(address)) return addressFromNode({ address: address[0] });
  if (typeof address !== "object") return { street: "", city: "", country: "" };
  if (address.address) return addressFromNode(address);
  return {
    street: decodeEntities(address.streetAddress || ""),
    city: decodeEntities(address.addressLocality || address.addressRegion || ""),
    country: decodeEntities(address.addressCountry
      ? typeof address.addressCountry === "object"
        ? address.addressCountry.name || ""
        : address.addressCountry
      : ""),
  };
}

/** Places, headline and publication out of the page's structured data. */
function readJsonLd(html) {
  const nodes = jsonLdObjects(html);
  if (!nodes.length) return null;

  let title = "";
  let source = "";
  const places = [];
  const seen = {};

  const take = (node) => {
    if (!node || typeof node !== "object" || !isPlaceNode(node)) return;
    const name = decodeEntities(node.name || "");
    if (!name || name.length > 200) return;
    const key = name.toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    const address = addressFromNode(node);
    const kind = categoryFromNode(node);
    places.push({
      name,
      area: "",
      address: address.street,
      city: address.city,
      country: address.country,
      excerpt: trimExcerpt(decodeEntities(node.description || ""), 400),
      image: imageFromNode(node),
      category: kind.category,
      cuisine: kind.cuisine,
    });
  };

  for (const node of nodes) {
    const types = typesOf(node);
    const isArticle = types.some(
      (type) => type.indexOf("article") !== -1 || type === "webpage" || type === "blogposting"
    );
    if (isArticle || types.indexOf("itemlist") !== -1) {
      if (!title) title = decodeEntities(node.headline || node.name || "");
      const publisher = node.publisher;
      if (!source && publisher) {
        source = decodeEntities(
          typeof publisher === "object" ? publisher.name || "" : String(publisher)
        );
      }
    }
    if (Array.isArray(node.itemListElement)) {
      for (const element of node.itemListElement) {
        if (!element || typeof element !== "object") continue;
        // A ListItem wraps the thing; some publications put the place directly in
        // the array instead.
        take(element.item || element);
      }
    }
    take(node);
  }

  if (places.length < 2) return null;
  return { places: places.slice(0, MAX_LIST_PLACES), title, source, readBy: "json_ld" };
}

/* ---------- reader 2: headings and the facts under them ---------- */

function looksLikeFurniture(heading) {
  const lowered = heading.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!lowered) return true;
  for (const phrase of NON_PLACE_HEADINGS) {
    if (lowered === phrase || lowered.indexOf(phrase) === 0) return true;
  }
  return false;
}

/**
 * The address out of a section's "get directions" link, as `{ address, city }`.
 *
 * The best address source these pages have, and better than any heuristic over
 * their prose: a maps link's `query` is written by the publication's own CMS out
 * of the fields it holds, in the order `Name, Street, City, Region Postcode`. The
 * name is dropped — it is already the heading — and what follows is split into
 * the street line and the city.
 *
 * Everything here is allowed to come back empty. An address is what buys the
 * place a pin on its private page; it is not what makes the place worth keeping.
 */
function addressFromMapsLink(section) {
  const match = /https?:\/\/(?:www\.)?google\.[a-z.]+\/maps\/search\/\?[^"']*?query=([^"'&]+)/i.exec(
    section
  );
  if (!match) return { address: "", city: "" };
  let query = "";
  try {
    query = decodeURIComponent(String(match[1]).replace(/\+/g, "%20"));
  } catch {
    return { address: "", city: "" };
  }
  const parts = decodeEntities(query)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return { address: "", city: "" };
  const street = parts[1];
  // The tail is "City" or "City, NY 10022"; a trailing region-and-postcode is
  // not a city and must not become one, or the whole list geocodes nowhere.
  const rest = parts.slice(2).filter((part) => !/^[A-Z]{2}\b|\d{4,}/.test(part));
  return {
    address: street.length <= 160 ? street : "",
    city: rest.length ? rest[0].slice(0, 120) : "",
  };
}

/** First match of a class-named element's text content, or "". */
function classedText(block, wordPattern) {
  const pattern = new RegExp(
    '<([a-z0-9]+)[^>]*class="[^"]*(?:' + wordPattern + ')[^"]*"[^>]*>([\\s\\S]{0,600}?)<\\/\\1>',
    "i"
  );
  const match = pattern.exec(block);
  return match ? textOf(match[2]) : "";
}

/** A numbered street line out of a block's text, or "". */
function addressFromText(text) {
  const pattern = new RegExp(
    "\\b\\d{1,5}[\\w\\-]*\\s+(?:[A-ZÀ-ɏ][\\w'’\\-\\.]*\\s+){0,5}(?:" +
      STREET_WORDS +
      ")\\b\\.?",
    "i"
  );
  const match = pattern.exec(text);
  if (!match) return "";
  const candidate = String(match[0]).trim();
  return candidate.length >= 6 && candidate.length <= 160 ? candidate : "";
}

/**
 * Places out of the page's own sectioning: a heading, and whatever locates it.
 *
 * Deliberately conservative about what counts. A heading on its own is a
 * subheading in an essay; a heading with an address, a neighbourhood, or a
 * mapped link is a card about a place. Requiring one of those is what stops this
 * reader turning a listicle's "Why we chose these" into a restaurant.
 */
function readStructured(html) {
  const read = factsByHeading(html);
  const places = [];
  for (const key of read.order) {
    if (places.length >= MAX_LIST_PLACES) break;
    const entry = read.facts[key];
    if (!entry.locatable) continue;
    places.push({
      name: entry.name,
      area: entry.area,
      address: entry.address,
      city: entry.city,
      country: "",
      excerpt: entry.excerpt,
      image: entry.image,
      // The scraper reads prose. Nothing in it declares a kind, so none is set.
      category: "",
      cuisine: "",
    });
  }
  if (places.length < MIN_STRUCTURED_PLACES) return null;
  const meta = pageTitleAndSource(html);
  return { places, title: meta.title, source: meta.source, readBy: "structured" };
}

/**
 * What the page says under each of its headings, keyed by the heading.
 *
 * The shared half of both free readers, and the reason they are not really
 * alternatives. JSON-LD is authoritative about *which* places are on a list — it
 * is the publication's own machine-readable answer — and says almost nothing
 * about where they are: Eater's ItemList carries thirty-eight names and not one
 * address. The page body has every address and no reliable way to tell a place's
 * heading from a section heading.
 *
 * So the facts are extracted once and both readers use them — the JSON-LD reader
 * to fill in what its names are missing, the structural reader as its only
 * source of places at all. Two passes for the two halves of one answer would be
 * the same work and one more thing to keep in agreement.
 */
function factsByHeading(html) {
  const headingPattern = /<h([23])\b[^>]*>([\s\S]{0,400}?)<\/h\1>/gi;
  const facts = {};
  const order = [];
  let match;
  while ((match = headingPattern.exec(html)) !== null && order.length < MAX_LIST_PLACES * 3) {
    const heading = textOf(match[2]);
    if (!heading || heading.length > 200 || looksLikeFurniture(heading)) continue;
    // Keyed by the same normalizer the catalogue matches with, so the JSON-LD
    // name and the heading meet even when one carries a curly apostrophe.
    const key = normalizePlacePart(heading);
    if (!key || facts[key]) continue;

    const block = html.slice(headingPattern.lastIndex, headingPattern.lastIndex + MAX_BLOCK_SCAN);
    // Stop at the next heading so one place's facts are never read off the next.
    const nextHeading = /<h[23]\b/i.exec(block);
    const section = nextHeading ? block.slice(0, nextHeading.index) : block;
    const sectionText = textOf(section);

    const mapped = addressFromMapsLink(section);
    const area = classedText(section, "neighborhood|neighbourhood|locality|district");
    const addressElement =
      classedText(section, "address|street-address|adr") ||
      (/<address[^>]*>([\s\S]{0,400}?)<\/address>/i.exec(section)
        ? textOf(/<address[^>]*>([\s\S]{0,400}?)<\/address>/i.exec(section)[1])
        : "");
    const address = mapped.address || addressElement || addressFromText(sectionText);
    const hasMapLink = /href="[^"]*(?:google\.[a-z.]+\/maps|maps\.app\.goo\.gl|openstreetmap)/i.test(
      section
    );
    facts[key] = {
      name: heading,
      area: area.slice(0, 120),
      address: String(address).slice(0, 300),
      city: mapped.city,
      country: "",
      excerpt: firstProseParagraph(section),
      image: firstSectionImage(section),
      // Whether this heading looks like a place at all rather than a section of
      // an essay. Only the structural reader consults it — the JSON-LD reader
      // already knows these are places and wants only their addresses.
      locatable: Boolean(address || area || hasMapLink),
    };
    order.push(key);
  }
  return { facts, order };
}

/**
 * The first paragraph under a heading that is actually about the place.
 *
 * Not simply the first `<p>`: these pages open each entry with a run of labelled
 * facts — "Open for: Lunch and dinner", "Price range: $$$$" — and taking the
 * first paragraph gets one of those every time. A member reading "Open for:
 * Lunch and dinner" under a restaurant's name on their own list has been given
 * nothing, and it looks like the reader is broken even though it is not.
 *
 * So a paragraph has to be long enough to be a sentence and must not open with a
 * short "Label:" prefix. Returns "" when nothing on offer qualifies, which is a
 * fine outcome: the excerpt is the least load-bearing thing extracted here.
 */
function firstProseParagraph(section) {
  const pattern = /<p[^>]*>([\s\S]{0,1200}?)<\/p>/gi;
  let match;
  let scanned = 0;
  while ((match = pattern.exec(section)) !== null && scanned < 8) {
    scanned += 1;
    const text = textOf(match[1]);
    if (text.length < 80) continue;
    if (/^[^.:]{1,24}:/.test(text)) continue;
    return trimExcerpt(text, 400);
  }
  return "";
}

/**
 * The first real photograph in a section, or "".
 *
 * `data-src` and `srcset` as well as `src`, because a lazy-loading page keeps a
 * transparent placeholder in `src` and the real address elsewhere — take the
 * naive one and every card gets the same 1×1 pixel. Anything that looks like an
 * icon, logo, avatar or tracking pixel is skipped: those are furniture, and a
 * publication's logo on every card is worse than no cover at all.
 */
function firstSectionImage(section) {
  const pattern = /<img\b([^>]*)>/gi;
  let match;
  let scanned = 0;
  while ((match = pattern.exec(section)) !== null && scanned < 12) {
    scanned += 1;
    const tag = match[1];
    if (/\b(?:class|id|alt)="[^"]*(?:logo|icon|avatar|sprite|pixel|badge|ad-)/i.test(tag)) continue;
    const srcset = /\bsrcset="([^"]+)"/i.exec(tag);
    const candidate =
      (/\bdata-src="([^"]+)"/i.exec(tag) || [])[1] ||
      (srcset ? String(srcset[1]).split(",")[0].trim().split(/\s+/)[0] : "") ||
      (/\bsrc="([^"]+)"/i.exec(tag) || [])[1] ||
      "";
    if (/^data:/i.test(candidate)) continue;
    const url = publicImageUrl(decodeEntities(candidate));
    if (url) return url;
  }
  return "";
}

function pageTitleAndSource(html) {
  const titleMatch =
    /<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i.exec(html) ||
    /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html);
  const siteMatch = /<meta[^>]+property="og:site_name"[^>]+content="([^"]*)"/i.exec(html);
  return {
    title: titleMatch ? decodeEntities(titleMatch[1]) : "",
    source: siteMatch ? decodeEntities(siteMatch[1]) : "",
  };
}

/* ---------- reader 3: the model, only when both above came back empty ---------- */

function openAiBaseUrl() {
  return $os.getenv("DETOUR_OPENAI_BASE_URL") || "https://api.openai.com";
}

function openAiModel() {
  return $os.getenv("DETOUR_OPENAI_MODEL") || "gpt-5.4-mini";
}

/**
 * The assistant's final text out of a Responses payload.
 *
 * A local copy of the same two helpers place_entries.js keeps private for
 * its web-discovery pass. Exporting them from there would make that module's
 * surface a general-purpose OpenAI client, which it is not, and the pair is
 * eight lines.
 */
function openAiOutputText(payload) {
  const items = (payload && payload.output) || [];
  let text = "";
  for (const item of items) {
    if (!item || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part && part.type === "output_text" && part.text) text += part.text;
    }
  }
  return text;
}

function parseModelAnswer(text) {
  const start = String(text).indexOf("{");
  const end = String(text).lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(String(text).slice(start, end + 1));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Places out of the page's text, when the page ships nothing readable.
 *
 * Reads the page the member pasted and nothing else — no web search, no browsing
 * on from it. That bound matters: the risk here is a plausible restaurant that
 * was never in the article, and a model that can only see this text can at least
 * only be wrong about this text. The instructions say so twice because it is the
 * one failure mode this reader has.
 */
function readWithModel(html) {
  const apiKey = $os.getenv("OPENAI_API_KEY");
  if (!apiKey) return null;
  const text = textOf(html).slice(0, MAX_MODEL_TEXT);
  if (text.length < 200) return null;

  const instructions =
    "You extract the list of food and drink venues from one article's text. " +
    "Use ONLY the text provided: never add a venue that does not appear in it, " +
    "and never complete a partial list from your own knowledge. Copy each name " +
    "exactly as written. Give the neighbourhood and street address only when " +
    "the text states them, and null otherwise — never infer either. The " +
    "excerpt is the publication's own words about that venue, copied verbatim: " +
    "its first sentence, and the second and third too when the text has them, " +
    "up to 400 characters. Never paraphrase, never cut a clause off the front " +
    "of a sentence, and never join sentences from different parts of the " +
    "article. LENGTH IS NOT A TEST OF WHETHER A VENUE BELONGS: a venue the " +
    "text gives a single line to is still on the list, with that line as its " +
    "excerpt. " +
    "Omit anything that is not a specific venue: cities, neighbourhoods, " +
    "dishes, chefs, and the publication itself. If the text is not a list of " +
    "venues, return an empty array. Respond with only this JSON object and " +
    'nothing else: {"title": string|null, "source": string|null, "places": ' +
    '[{"name": string, "area": string|null, "address": string|null, ' +
    '"city": string|null, "excerpt": string|null}]}';

  let response;
  try {
    response = $http.send({
      url: openAiBaseUrl() + "/v1/responses",
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: openAiModel(),
        // Extraction from supplied text needs no deliberation, and this reader is
        // already the expensive path.
        reasoning: { effort: "low" },
        instructions,
        input: text,
      }),
      timeout: 120,
    });
  } catch {
    return null;
  }
  if (!response || response.statusCode < 200 || response.statusCode >= 300) return null;

  let payload;
  try {
    payload = response.json;
  } catch {
    return null;
  }
  const answer = parseModelAnswer(openAiOutputText(payload));
  if (!answer || !Array.isArray(answer.places)) return null;

  const places = [];
  const seen = {};
  for (const entry of answer.places) {
    if (!entry || typeof entry !== "object") continue;
    const name = decodeEntities(String(entry.name || ""));
    if (!name || name.length > 200) continue;
    const key = name.toLowerCase();
    if (seen[key]) continue;
    // The one check available against invention: the name has to be in the text
    // the model was given. It does not catch a real venue attributed to the
    // wrong list, and nothing here could.
    if (text.toLowerCase().indexOf(key) === -1) continue;
    seen[key] = true;
    places.push({
      name,
      area: decodeEntities(String(entry.area || "")).slice(0, 120),
      address: decodeEntities(String(entry.address || "")).slice(0, 300),
      city: decodeEntities(String(entry.city || "")).slice(0, 120),
      country: "",
      excerpt: trimExcerpt(decodeEntities(String(entry.excerpt || "")), 400),
      category: "",
      cuisine: "",
    });
    if (places.length >= MAX_LIST_PLACES) break;
  }
  if (places.length < 2) return null;
  return {
    places,
    title: decodeEntities(String(answer.title || "")),
    source: decodeEntities(String(answer.source || "")),
    readBy: "model",
  };
}

/* ---------- the reader, in order ---------- */

/**
 * Read a list page. Returns `{ places, title, source, readBy, url }` or null.
 *
 * Null is the whole contract with the caller: a link that cannot be read changes
 * nothing, the route answers 200 with `resolved: false`, and the member is not
 * asked to accept a half-read list. Nothing in this feature may ever be made to
 * depend on a page having been readable.
 */
function readListPage(url) {
  const safeUrl = listPageUrl(url);
  if (!safeUrl) return null;
  const html = fetchListPage(safeUrl);
  if (!html) return null;

  let result = readJsonLd(html);
  // JSON-LD names the places and rarely locates them, so whatever the page body
  // says under the matching heading is folded in. Only ever fills gaps: a fact
  // the publication put in its structured data outranks one scraped out of its
  // prose.
  if (result) result = withPageFacts(result, html);
  if (!result) result = readStructured(html);
  if (!result) result = readWithModel(html);
  if (!result) return null;

  const host = (/^https?:\/\/([^/?#]+)/i.exec(safeUrl) || ["", ""])[1].replace(/^www\./i, "");
  return {
    places: result.places,
    // A headline is what the member is offered as the list's name; the host is a
    // legible last resort, because an untitled list on the tab is unreadable.
    title: cleanTitle(result.title) || host,
    source: result.source || host,
    readBy: result.readBy,
    url: safeUrl,
  };
}

/** Fills a JSON-LD result's gaps from what the page body says under each name. */
function withPageFacts(result, html) {
  const read = factsByHeading(html);
  const places = [];
  for (const place of result.places) {
    const entry = read.facts[normalizePlacePart(place.name)];
    if (!entry) {
      places.push(place);
      continue;
    }
    places.push({
      name: place.name,
      area: place.area || entry.area,
      address: place.address || entry.address,
      city: place.city || entry.city,
      country: place.country,
      excerpt: place.excerpt || entry.excerpt,
      image: place.image || entry.image,
      category: place.category || "",
      cuisine: place.cuisine || "",
    });
  }
  const meta = pageTitleAndSource(html);
  return {
    places,
    title: result.title || meta.title,
    source: result.source || meta.source,
    readBy: result.readBy,
  };
}

/** A headline without the publication's own suffix ("… - Eater NY"). */
function cleanTitle(value) {
  const raw = decodeEntities(value).slice(0, 300);
  if (!raw) return "";
  const trimmed = raw.replace(/\s*[|–—-]\s*[^|–—-]{2,40}$/, "").trim();
  return (trimmed.length >= 8 ? trimmed : raw).slice(0, 200);
}

/* ---------- matching against the catalogue ---------- */

/**
 * The published venue this imported place already is, or "".
 *
 * Matched through `community_place_entries` rather than `venues` directly,
 * because the entry is what carries publication state and what already holds the
 * normalized name and city the catalogue compares by — the same two columns
 * written here, through the same `normalizePlacePart`, so an imported "Café
 * Mütter" finds a recommended "cafe mutter".
 *
 * Any disambiguator matches. A member importing a name from an article has no
 * qualifier to offer, and the alternative — refusing to match a place precisely
 * because two places share its name — would hide the real place from them on the
 * one occasion the catalogue had something to say.
 */
function matchPublishedVenue(app, normalizedName, normalizedCity, fallbackCity) {
  if (!normalizedName) return "";
  // A list's own city as well as the place's, because publications file by
  // borough and district — Eater gives "Astoria" and "Bronx" where Detour's
  // catalogue files everything under "New York". Without the second attempt a
  // member importing a New York list would be told Detour has none of it while
  // half of it is already there.
  const cities = [];
  for (const city of [normalizedCity, fallbackCity]) {
    if (city && cities.indexOf(city) === -1) cities.push(city);
  }
  for (const city of cities) {
    let entry;
    try {
      entry = app.findFirstRecordByFilter(
        "community_place_entries",
        "normalized_name = {:name} && normalized_city = {:city} && status = 'published' && " +
          "published_venue != ''",
        { name: normalizedName, city }
      );
    } catch {
      continue;
    }
    if (!entry) continue;
    const venueId = entry.getString("published_venue");
    try {
      const venue = app.findRecordById("venues", venueId);
      if (venue.get("suppressed") === true) continue;
    } catch {
      continue;
    }
    return venueId;
  }
  return "";
}

/** The waiting-list entry a matched venue belongs to, or null. */
function entryForVenue(app, venueId) {
  if (!venueId) return null;
  try {
    return app.findFirstRecordByFilter(
      "community_place_entries",
      "published_venue = {:venue}",
      { venue: venueId }
    );
  } catch {
    return null;
  }
}

/* ---------- the member's own rows ---------- */

/** This member's imported row for this place, or null. */
function findImportedPlace(app, memberId, normalizedName, normalizedCity) {
  try {
    return app.findFirstRecordByFilter(
      "community_imported_places",
      "member = {:member} && normalized_name = {:name} && normalized_city = {:city}",
      { member: memberId, name: normalizedName, city: normalizedCity }
    );
  } catch {
    return null;
  }
}

/** This member's list for this source URL, or null. */
function findGuideBySource(app, memberId, sourceUrl) {
  try {
    return app.findFirstRecordByFilter(
      "community_guides",
      "member = {:member} && source_url = {:url}",
      { member: memberId, url: sourceUrl }
    );
  } catch {
    return null;
  }
}

function placePayload(record) {
  return {
    id: record.id,
    name: record.getString("name"),
    area: record.getString("area"),
    city: record.getString("city"),
    country: record.getString("country"),
    address: record.getString("address"),
    lat: Number(record.get("lat")) || 0,
    lng: Number(record.get("lng")) || 0,
    // Whether locating has been attempted, so a surface can tell "not placed
    // yet" from "cannot be placed". Without it, a list page counting unplaced
    // places promises pins that are never coming — some addresses simply have no
    // match, and those are stamped and not retried for a week. The note itself
    // stays private; this is the one bit of it a member needs.
    locate_tried: Boolean(record.getString("located_at")),
    excerpt: record.getString("excerpt"),
    // What kind of place the publication said it is, and its own word for the
    // cuisine. Empty whenever the page declared neither — see the migration.
    category: record.getString("category"),
    cuisine: record.getString("cuisine"),
    source_url: record.getString("source_url"),
    image_url: record.getString("image_url"),
    matched_venue: record.getString("matched_venue"),
    // "Not this one." The place stays on the list it came from, dimmed, and
    // leaves the wishlist, the city page and every count — see the migration.
    skipped: Boolean(record.get("skipped")),
    guides: record.get("guides") || [],
    created: record.getString("created"),
  };
}

/**
 * The caller's own lists, newest first, each with its places.
 *
 * The only read path this feature has, and — like Wanna go's — safe to serve in
 * full precisely because it is never anybody else's. `matched_venue` is
 * re-checked on every read: a place nobody had recommended in August may have
 * been recommended by October, and the moment it is, the member's private row
 * should open the real place page with the note on it. That re-check is the one
 * thing this feature does that pays off over time, so it happens on the read
 * rather than waiting for a sweep.
 */
function ownGuides(app, memberId) {
  let lists;
  try {
    lists = app.findRecordsByFilter(
      "community_guides",
      "member = {:member}",
      "-created",
      200,
      0,
      { member: memberId }
    );
  } catch {
    return { items: [], ungrouped: [] };
  }
  // No early return on an empty set of lists, deliberately: a member who removed
  // their only list and kept its places holds places and no lists at all, and
  // bailing here would hide every one of them.

  // The city each list is about, so a place filed under a borough can still be
  // re-matched against a catalogue that files under the city.
  const listCity = {};
  for (const list of lists) listCity[list.id] = list.getString("normalized_city");

  let places;
  try {
    places = app.findRecordsByFilter(
      "community_imported_places",
      "member = {:member}",
      "-created",
      2000,
      0,
      { member: memberId }
    );
  } catch {
    places = [];
  }

  const byList = {};
  const ungrouped = [];
  for (const place of places) {
    // A place whose catalogue match arrived after it was imported.
    if (!place.getString("matched_venue")) {
      const owning = (place.get("guides") || [])
        .map((id) => listCity[id])
        .filter(Boolean)[0];
      const venueId = matchPublishedVenue(
        app,
        place.getString("normalized_name"),
        place.getString("normalized_city"),
        owning
      );
      if (venueId) {
        place.set("matched_venue", venueId);
        try {
          app.save(place);
        } catch {
          // A failed write costs this read its match and nothing else; the next
          // one tries again.
        }
      }
    }
    const payload = placePayload(place);
    // A place belonging to no list is not lost — it is one the member chose to
    // keep when they removed the list it arrived on. It is returned separately
    // so the tab can show it under "Not from a list" rather than under nothing,
    // which is how a kept place would silently disappear.
    if (!payload.guides.length) {
      ungrouped.push(payload);
      continue;
    }
    for (const listId of payload.guides) {
      if (!byList[listId]) byList[listId] = [];
      byList[listId].push(payload);
    }
  }

  const items = [];
  for (const list of lists) {
    items.push({
      id: list.id,
      title: list.getString("title"),
      source_name: list.getString("source_name"),
      source_title: list.getString("source_title"),
      source_url: list.getString("source_url"),
      created: list.getString("created"),
      places: byList[list.id] || [],
    });
  }
  return { items, ungrouped };
}

/* ---------- locating a private place ---------- */

/**
 * Fill in an imported place's coordinates from its address, once.
 *
 * Lazy on purpose. Thirty-eight Nominatim lookups inside the import request
 * would exceed both the request and the service's own one-per-second policy, and
 * most imported places are never opened. So this runs when a private page is
 * opened, for that one place, and stamps the attempt either way so an address
 * that does not geocode is retried weekly rather than on every open — the same
 * bound, for the same reason, as `venues.web_discovery_at`.
 *
 * Best effort and never throws: a private page with no pin is a page with no
 * pin. The claimed-city guard is the catalogue's, because a street address with
 * no city attached geocodes to the wrong continent often enough to matter.
 */
function locateImportedPlace(app, record, fallbackCity) {
  const existingLat = Number(record.get("lat"));
  const existingLng = Number(record.get("lng"));
  if (Number.isFinite(existingLat) && Number.isFinite(existingLng) && (existingLat !== 0 || existingLng !== 0)) {
    return false;
  }
  const address = cleanText(record.getString("address"), 300);
  const placeCity = cleanText(record.getString("city"), 120);
  const listCity = cleanText(fallbackCity, 120);
  // Both cities go into the query and both satisfy the guard below. A
  // publication files by borough — "2419 Steinway St, Astoria" — and Nominatim
  // answers with `city: New York` and calls Astoria a suburb, so a guard that
  // only knew the place's own city would reject every correct answer on the
  // list. Accepting either is what makes a borough-filed list locatable at all.
  const city = placeCity || listCity;
  if (!address || !city) return false;
  const claimed = [placeCity, listCity].filter(Boolean).map(normalizePlacePart);

  const stampRaw = record.getString("located_at");
  const lastAttempt = stampRaw ? new Date(stampRaw.replace(" ", "T")).getTime() : 0;
  if (lastAttempt > 0 && Date.now() - lastAttempt < LOCATE_RETRY_MS) return false;

  const country = cleanText(record.getString("country"), 120);
  let response;
  try {
    response = $http.send({
      url:
        nominatimBaseUrl() +
        "/search?format=jsonv2&limit=1&addressdetails=1&accept-language=en&q=" +
        encodeURIComponent(
          [address, placeCity, listCity === placeCity ? "" : listCity, country]
            .filter(Boolean)
            .join(", ")
        ),
      method: "GET",
      // Nominatim's usage policy asks for an application and a way to reach
      // whoever runs it. The rest of this codebase introduces itself the same way.
      headers: { "User-Agent": "Detour imported list locator (+https://takedetour.app)" },
      timeout: 10,
    });
  } catch {
    return false; // transport failure: leave unstamped so the next open retries
  }

  record.set("located_at", new Date().toISOString());

  const finish = (note) => {
    record.set("located_note", cleanText(note, 300));
    try {
      app.save(record);
    } catch {
      // Nothing to do: the coordinates are absent either way.
    }
    return true;
  };

  if (!response || response.statusCode !== 200) {
    return finish("Geocoding answered HTTP " + (response ? response.statusCode : "?") + ".");
  }
  let results;
  try {
    results = response.json;
  } catch {
    return finish("Geocoding returned an unreadable answer.");
  }
  if (!Array.isArray(results) || !results.length) {
    return finish("Geocoding found no match for this address.");
  }
  const hit = results[0];
  const lat = parseFloat(hit.lat);
  const lng = parseFloat(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
    return finish("Geocoding returned no usable coordinates.");
  }
  const parts = hit.address || {};
  // The suburb and borough fields too: a place filed under "Astoria" is answered
  // with city New York and suburb Astoria, and both are the truth about it.
  const hitNames = [
    parts.city,
    parts.town,
    parts.village,
    parts.municipality,
    parts.suburb,
    parts.borough,
    parts.city_district,
  ]
    .filter(Boolean)
    .map(String);
  const agreed = hitNames.some((name) => claimed.indexOf(normalizePlacePart(name)) !== -1);
  if (hitNames.length && !agreed) {
    return finish(
      "Geocoded city (" + hitNames[0] + ") does not match " + city + "; coordinates withheld."
    );
  }
  record.set("lat", lat);
  record.set("lng", lng);
  return finish("Located via OpenStreetMap Nominatim: " + String(hit.display_name || ""));
}

/**
 * Locate a batch of a member's still-unplaced imported places.
 *
 * The list map is the reason this exists. One place at a time, filled in when
 * its own page is opened, is right for a place page and useless for a map of
 * thirty-eight — a map that plots four of them is worse than no map.
 *
 * Bounded rather than exhaustive, and called from two places: the list page
 * opens with a small batch so a freshly imported list has pins almost at once,
 * and an hourly sweep works through whatever is left. OpenStreetMap asks for no
 * more than one lookup a second and this is somebody else's service; a loop over
 * a hundred addresses inside one page load would abuse it and time the request
 * out. `located_at` bounds the retries, so a batch never re-attempts an address
 * that failed this week.
 */
function locateGuidePlaces(app, memberId, listId, limit) {
  let list;
  try {
    list = app.findRecordById("community_guides", listId);
  } catch {
    return 0;
  }
  if (list.getString("member") !== memberId) return 0;
  const city = list.getString("city");

  let places;
  try {
    places = app.findRecordsByFilter(
      "community_imported_places",
      "member = {:member}",
      "created",
      2000,
      0,
      { member: memberId }
    );
  } catch {
    return 0;
  }

  let done = 0;
  for (const place of places) {
    if (done >= limit) break;
    const held = [];
    for (const id of place.get("guides") || []) held.push(String(id));
    if (held.indexOf(listId) === -1) continue;
    if (locateImportedPlace(app, place, city)) done += 1;
  }
  return done;
}

/**
 * The same, across every member, for the hourly sweep.
 *
 * Ordered by `located_at` so places never attempted come first and the rest
 * round-robin by staleness — one member importing a hundred places cannot starve
 * everybody else's map indefinitely.
 */
function locateSweepBatch(app, limit) {
  let places;
  try {
    places = app.findRecordsByFilter(
      "community_imported_places",
      "address != '' && lat = 0",
      "located_at",
      limit * 4,
      0
    );
  } catch {
    return 0;
  }
  const listCity = {};
  let done = 0;
  for (const place of places) {
    if (done >= limit) break;
    // The list's city, for the borough case. Looked up once per list.
    let city = "";
    for (const id of place.get("guides") || []) {
      const listId = String(id);
      if (!(listId in listCity)) {
        try {
          listCity[listId] = app.findRecordById("community_guides", listId).getString("city");
        } catch {
          listCity[listId] = "";
        }
      }
      if (listCity[listId]) {
        city = listCity[listId];
        break;
      }
    }
    if (locateImportedPlace(app, place, city)) done += 1;
  }
  return done;
}

function nominatimBaseUrl() {
  return $os.getenv("DETOUR_NOMINATIM_BASE_URL") || "https://nominatim.openstreetmap.org";
}

/* ---------- shared text helpers ---------- */
//
// Local copies rather than a require() of place_entries.js at module scope:
// that module reaches for `$os`, `$http` and the catalogue on load, and this one
// is required by a route that may only be reading a page. `normalizePlacePart`
// must stay character-for-character identical to the catalogue's, because it is
// what decides whether an imported place is a place Detour already knows.

function cleanText(value, max) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * An excerpt cut to fit, on a sentence where there is one.
 *
 * A hard slice at the cap put "everything comes from the restaurant's own 1,500
 * square" on a card — which reads as a bug rather than as a quotation, and is
 * the one thing a quotation may not do. The last whole sentence is preferred;
 * only when that would throw away most of the allowance does it fall back to
 * the last whole word, and then it says so with an ellipsis.
 */
function trimExcerpt(value, max) {
  const text = cleanText(value, 4000);
  if (text.length <= max) return text;
  const window = text.slice(0, max);
  let cut = -1;
  for (const mark of [". ", "! ", "? ", "… ", "." , "!", "?"]) {
    const at = window.lastIndexOf(mark);
    if (at > cut) cut = at;
  }
  // Any whole sentence beats a longer fragment. Keeping the extra 240 characters
  // cost this one "everything comes from the restaurant's own 1,500…", and a
  // quotation that stops inside a number is not a quotation.
  if (cut >= 80) return window.slice(0, cut + 1).trim();
  const space = window.lastIndexOf(" ");
  return (space > 0 ? window.slice(0, space) : window).trim() + "…";
}

function normalizePlacePart(value) {
  let normalized = cleanText(value, 300);
  if (typeof normalized.normalize === "function") {
    normalized = normalized.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  }
  return normalized
    .toLowerCase()
    .replace(/[\u2019'`\u00b4]/g, "")
    .replace(/&/g, " and ")
    .replace(/[\u2010-\u2015]/g, " ")
    .replace(/[.,/#!$%^*;:{}=\-_~()\[\]"?<>\\|+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = {
  MAX_LIST_PLACES,
  cleanText,
  cleanTitle,
  entryForVenue,
  findImportedPlace,
  findGuideBySource,
  importedCategory,
  listPageUrl,
  locateImportedPlace,
  locateGuidePlaces,
  locateSweepBatch,
  matchPublishedVenue,
  normalizePlacePart,
  ownGuides,
  placePayload,
  publicImageUrl,
  readListPage,
};
