/// <reference path="../pb_data/types.d.ts" />

/**
 * Map links, read rather than looked up.
 *
 * A member who wants to recommend somewhere has almost always got the place open
 * in Maps already — the share sheet is one tap and produces a link. This module
 * turns that link back into the two things the recommendation form asks for, the
 * name and the city, so the member types the only part nobody else can write:
 * the note.
 *
 * This is parsing, not a place lookup. Everything here comes out of the URL the
 * member pasted; no Places API is called, nothing is billed, and nothing arrives
 * with terms attached about how long it may be stored. The one network request is
 * following a short link to the long one it stands for — `maps.app.goo.gl/xxxx`
 * carries no name and no coordinates, and it is what the mobile share sheet
 * actually produces, so without that hop the parser would almost never fire.
 *
 * Coordinates are a nice-to-have and the city is derived from them, so both are
 * allowed to fail. The contract with the caller is that a link which cannot be
 * read changes nothing: `parseMapLink` returns null, the route answers 200 with
 * `resolved: false`, and whatever the member had typed is still theirs. Nothing
 * in the recommendation path may ever depend on a link having been read — see
 * `resolvePlaceLink` and the route that wraps it.
 */

const SHORT_LINK_HOSTS = [
  "maps.app.goo.gl",
  "goo.gl",
  "maps.google.com",
  "g.co",
];

const MAX_LINK_LENGTH = 2048;
/** Enough of the redirect page to hold its <head>, and far short of a whole map. */
const MAX_BODY_SCAN = 200000;

/**
 * Two callers, two different obligations.
 *
 * Nominatim's usage policy requires a user agent that identifies the
 * application and a way to reach whoever runs it, and the rest of this codebase
 * already introduces itself that way. Google's short-link host does the
 * opposite: it answers an unrecognised agent with a JavaScript shell that names
 * no place at all, and answers a browser with markup that does. The link being
 * followed is one a member just pasted, on their behalf, once.
 */
const NOMINATIM_USER_AGENT =
  "Detour place link reader (contact: olga@supernaut.dev)";
const LINK_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
/**
 * The agents Google renders a static preview for.
 *
 * A browser gets the map application, which without JavaScript is an empty
 * shell with the destination nowhere in its body. A link-preview bot gets a
 * server-rendered page with the place name in `og:title` — that page is how a
 * pasted maps link shows its name in a chat app, and it is the only response
 * in this whole chain that names the place in markup.
 */
const PREVIEW_USER_AGENTS = [
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  "Twitterbot/1.0",
];

/** A pasted value that is plausibly a link, or "". */
function normalizeLink(value) {
  const raw = String(value === undefined || value === null ? "" : value).trim();
  if (!raw || raw.length > MAX_LINK_LENGTH) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
  if (!/^https:\/\/[^\s]+$/i.test(withScheme) && !/^http:\/\/[^\s]+$/i.test(withScheme)) {
    return "";
  }
  return withScheme;
}

function hostOf(url) {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url);
  if (!match) return "";
  return match[1].toLowerCase().replace(/^www\./, "");
}

/**
 * True for the hosts whose links carry no place in them, only an identifier that
 * has to be exchanged for the real URL. `maps.google.com` is here because its
 * `?cid=` form is a redirect too.
 */
function isShortLink(url) {
  const host = hostOf(url);
  if (!host) return false;
  for (const candidate of SHORT_LINK_HOSTS) {
    if (host === candidate) {
      // A maps.google.com link that already names a place is long, not short.
      if (candidate === "maps.google.com" && /\/maps\/place\//i.test(url)) return false;
      return true;
    }
  }
  return false;
}

/**
 * A URL path or query segment as text: percent-decoded, `+` as space.
 *
 * The two substitutions have to survive each other. A link that arrives through
 * the consent page has been encoded twice, so its spaces reach here as `%2B` and
 * only become `+` once decoding has run — replacing before decoding would leave
 * "Cafe+Bunna", and replacing only after would miss the plain `+` in a link that
 * was encoded once. So `+` is folded into the decode as `%20`, and anything that
 * decoding then reveals is folded in after it.
 */
function decodeSegment(value) {
  const raw = String(value || "");
  let text;
  try {
    text = decodeURIComponent(raw.replace(/\+/g, "%20"));
  } catch {
    // A half-encoded segment is still worth the readable part of itself.
    text = raw.replace(/\+/g, " ");
  }
  return text.replace(/\+/g, " ").replace(/\s+/g, " ").trim();
}

/** Rejects the segments Google puts where a name goes that are not names. */
function looksLikeName(value) {
  if (!value || value.length < 2 || value.length > 200) return false;
  // "@41.39,2.16,17z", "41.3925,2.1656" and bare plus codes are locations.
  if (/^@/.test(value)) return false;
  if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?/.test(value)) return false;
  // A plus code with the locality that follows it — "9F4M+2X Berlin" — is a
  // coordinate written out, not what anybody calls the place. The `+` has
  // already become a space by the time this runs, so both forms are matched.
  if (/^[23456789CFGHJMPQRVWX]{4,8}[+\s][23456789CFGHJMPQRVWX]{2,3}(\s|$)/i.test(value)) return false;
  if (/^data=/i.test(value) || /^dir$/i.test(value) || /^search$/i.test(value)) return false;
  return true;
}

/**
 * The place name and whatever address rode along with it.
 *
 * Google's `/maps/place/` segment is sometimes the bare name and sometimes the
 * name with the full postal address appended, comma-separated. The first part is
 * the name in both cases; the rest is address text, which is worth keeping
 * because it is how the city gets named without a network call.
 */
function splitPlaceSegment(segment) {
  const text = decodeSegment(segment);
  if (!text) return { name: "", address: "" };
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return { name: "", address: "" };
  const name = parts[0];
  return {
    name: looksLikeName(name) ? name : "",
    address: parts.slice(1).join(", "),
  };
}

/**
 * Coordinates, preferring the place's own over the map's.
 *
 * `@lat,lng,17z` is where the viewport was centred when the link was made, which
 * is close to the place but is not the place. The `!3d…!4d…` pair inside `data=`
 * is the pin itself, so it wins whenever Google included it.
 */
function coordinatesFrom(url) {
  const pin = /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/.exec(url);
  const viewport = /@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/.exec(url);
  const chosen = pin || viewport;
  if (!chosen) return null;
  const lat = Number(chosen[1]);
  const lng = Number(chosen[2]);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/** One query parameter's raw value, or "". */
function queryValue(url, key) {
  const match = new RegExp("[?&]" + key + "=([^&#]*)", "i").exec(url);
  return match ? match[1] : "";
}

/**
 * What a long map URL says, or null when it says nothing usable.
 *
 * Handles the shapes people actually paste: Google's `/maps/place/Name/@lat,lng`,
 * its `?q=` and `?query=` search forms, and Apple's `?q=` with `&ll=`. A link
 * that yields neither a name nor coordinates is not a map link as far as this is
 * concerned, and the caller is expected to leave the member's own typing alone.
 */
function parseMapLink(value) {
  const url = normalizeLink(value);
  if (!url) return null;

  let name = "";
  let address = "";

  const placeSegment = /\/maps\/place\/([^/@?#]+)/i.exec(url);
  if (placeSegment) {
    const split = splitPlaceSegment(placeSegment[1]);
    name = split.name;
    address = split.address;
  }

  if (!name) {
    // ?q= is Google's older share form and Apple's current one; ?query= belongs
    // to Google's Maps URLs API; ?name= turns up in Apple place links.
    for (const key of ["q", "query", "name", "destination"]) {
      const candidate = decodeSegment(queryValue(url, key));
      if (!candidate) continue;
      const split = splitPlaceSegment(encodeURIComponent(candidate));
      if (split.name) {
        name = split.name;
        if (!address) address = split.address;
        break;
      }
    }
  }

  let coordinates = coordinatesFrom(url);
  if (!coordinates) {
    // Apple carries the pin in `ll`, and both carry `sll` for a search origin.
    const ll = decodeSegment(queryValue(url, "ll")) || decodeSegment(queryValue(url, "sll"));
    const pair = /^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(ll);
    if (pair) {
      const lat = Number(pair[1]);
      const lng = Number(pair[2]);
      if (isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        coordinates = { lat, lng };
      }
    }
  }

  if (!name && !coordinates) return null;
  return {
    name: name,
    address: address,
    lat: coordinates ? coordinates.lat : null,
    lng: coordinates ? coordinates.lng : null,
  };
}

/**
 * The long URL a short link stands for.
 *
 * PocketBase's HTTP client follows redirects and does not report where it ended
 * up, so the destination is read out of what came back instead: the `Location`
 * header when the hop was not followed, and otherwise the first map URL in the
 * body — Google's interstitial names it in an anchor, and a real map page names
 * it in `og:url` or a canonical link. Returns "" when nothing map-shaped is
 * there, which is treated exactly like an unreadable link.
 */
function expandShortLink(url) {
  let response;
  try {
    response = $http.send({
      url: url,
      method: "GET",
      headers: {
        // A browser user agent, because the interstitial Google serves a bot is
        // a JavaScript shell with the destination nowhere in it. This asks for
        // the same HTML a phone would get, which names the place in its markup.
        "User-Agent": LINK_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en",
      },
      timeout: 8,
    });
  } catch {
    return "";
  }
  if (!response) return "";

  const headers = response.headers || {};
  for (const key of Object.keys(headers)) {
    if (String(key).toLowerCase() !== "location") continue;
    const value = headers[key];
    const location = Array.isArray(value) ? value[0] : value;
    const direct = mapUrlIn(String(location || ""));
    if (direct) return direct;
  }

  return mapUrlIn(String(response.raw || "").slice(0, MAX_BODY_SCAN));
}

/**
 * The first Google Maps URL in a piece of text, however it was written there.
 *
 * A redirect chain hides the destination in more than one way. An interstitial
 * puts it in an HTML-escaped anchor. A consent page — which is what a European
 * IP gets — puts it percent-encoded inside its own `continue=` parameter, where
 * an ordinary URL match cannot see it. A rendered map page names itself in
 * `og:url`. All three are the same question, so all three are asked here, on the
 * text as written and on the text once decoded.
 */
function mapUrlIn(text) {
  if (!text) return "";
  const pattern =
    /https?:\/\/(?:www\.)?(?:google\.[a-z.]{2,6}|maps\.google\.[a-z.]{2,6})\/maps\/[^"'\s<>\\&]*[^"'\s<>\\]*/i;

  const direct = pattern.exec(text);
  if (direct) {
    const cleaned = unescapeHtml(direct[0]);
    if (/\/maps\/place\//i.test(cleaned) || /@-?\d/.test(cleaned)) return cleaned;
  }

  // Percent-decoded, for the URL carried inside another URL's query string.
  let decoded = "";
  try {
    decoded = decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    // A body that is not wholly decodable still decodes in pieces below.
  }
  if (decoded) {
    const nested = pattern.exec(decoded);
    if (nested) {
      const cleaned = unescapeHtml(nested[0]);
      if (/\/maps\/place\//i.test(cleaned) || /@-?\d/.test(cleaned)) return cleaned;
    }
  }

  // The consent interstitial carries the destination as a hidden form value —
  // an HTML-escaped attribute, sometimes percent-encoded on top. Both name
  // orders occur, so both are asked for.
  const consent =
    /name=["']continue["'][^>]*value=["']([^"']+)["']/i.exec(text) ||
    /value=["']([^"']*google\.[a-z.]{2,6}[^"']*maps[^"']*)["'][^>]*name=["']continue["']/i.exec(text);
  if (consent) {
    let candidate = unescapeHtml(consent[1]);
    try {
      if (/%2F|%3A/i.test(candidate)) candidate = decodeURIComponent(candidate);
    } catch {
      // Left as it was; the pattern below decides whether it is usable.
    }
    if (/\/maps\//i.test(candidate)) return candidate;
  }

  // Last resort: the escaped-unicode form Google's own page data uses, where a
  // slash arrives as \/ and the URL is a JSON string rather than an attribute.
  const escaped = /https?:\\\/\\\/(?:www\.)?google\.[a-z.]{2,6}\\\/maps\\\/[^"'\s<>]+/i.exec(text);
  if (escaped) {
    const cleaned = unescapeHtml(escaped[0].replace(/\\\//g, "/"));
    if (/\/maps\/place\//i.test(cleaned) || /@-?\d/.test(cleaned)) return cleaned;
  }

  return direct ? unescapeHtml(direct[0]) : "";
}

/**
 * A URL taken out of HTML, as the URL it was before escaping.
 *
 * Google's redirect interstitial escapes the destination into an anchor, so an
 * apostrophe in a place name arrives as `&#39;`. Left alone it truncates the
 * name at the `#`, because a fragment is where a URL path stops.
 */
function unescapeHtml(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

/** One meta tag's content, tolerant of either attribute order. */
function metaContent(html, property) {
  const forward = new RegExp(
    '<meta[^>]+(?:property|name|itemprop)=["\']' + property + '["\'][^>]*content=["\']([^"\']*)["\']',
    "i"
  ).exec(html);
  if (forward) return unescapeHtml(forward[1]).trim();
  const reversed = new RegExp(
    '<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name|itemprop)=["\']' + property + '["\']',
    "i"
  ).exec(html);
  return reversed ? unescapeHtml(reversed[1]).trim() : "";
}

/** A preview title as a place name: the branding stripped, emptiness admitted. */
function cleanPreviewTitle(title) {
  const cleaned = String(title || "")
    .replace(/\s*[·\-–—|]\s*Google\s*Maps?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || /^google maps?$/i.test(cleaned)) return "";
  return looksLikeName(cleaned) ? cleaned : "";
}

/**
 * What the link-preview rendering of a short link says about the place.
 *
 * The fallback for when following the link lands on a page that names nothing —
 * the JavaScript shell, or a consent interstitial with the destination stripped.
 * Asks as a preview bot, which is the audience Google still serves static
 * markup to, and reads the same page a chat app reads to caption the link.
 * Coordinates ride along when the preview's static-map image names its centre.
 */
function previewPlaceFrom(url) {
  for (const agent of PREVIEW_USER_AGENTS) {
    let response;
    try {
      response = $http.send({
        url: url,
        method: "GET",
        headers: {
          "User-Agent": agent,
          Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
          "Accept-Language": "en",
        },
        timeout: 8,
      });
    } catch {
      continue;
    }
    if (!response) continue;
    const body = String(response.raw || "").slice(0, MAX_BODY_SCAN);
    if (!body) continue;

    // Best case: this variant of the page names the long URL outright.
    const mapUrl = mapUrlIn(body);
    if (mapUrl) {
      const parsed = parseMapLink(mapUrl);
      if (parsed && (parsed.name || parsed.lat !== null)) return parsed;
    }

    const name = cleanPreviewTitle(
      metaContent(body, "og:title") || metaContent(body, "twitter:title")
    );
    const description = metaContent(body, "og:description") || metaContent(body, "description");
    let coordinates = null;
    const centre = /(?:center|markers)=(-?\d{1,3}\.\d+)(?:%2C|,)(-?\d{1,3}\.\d+)/i.exec(body);
    if (centre) {
      const lat = Number(centre[1]);
      const lng = Number(centre[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0)) {
        coordinates = { lat: lat, lng: lng };
      }
    }
    if (!name && !coordinates) continue;
    return {
      name: name,
      // The preview's description is the address line a chat app shows under
      // the name; it is address text, not prose, and the route caps it anyway.
      address: String(description || "").slice(0, 300),
      lat: coordinates ? coordinates.lat : null,
      lng: coordinates ? coordinates.lng : null,
    };
  }
  return null;
}

/**
 * The city and country at a set of coordinates, or null.
 *
 * Reverse geocoding is the last and least important step: the form already has a
 * city in it, prefilled from the member's own home city, and that is right far
 * more often than not for the place someone keeps going back to. This only
 * improves on it, so every failure here is silent by design.
 */
function cityFromCoordinates(lat, lng) {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  const base = $os.getenv("DETOUR_NOMINATIM_URL") || "https://nominatim.openstreetmap.org";
  let response;
  try {
    response = $http.send({
      url:
        base +
        "/reverse?format=jsonv2&zoom=14&addressdetails=1&accept-language=en&lat=" +
        encodeURIComponent(String(lat)) +
        "&lon=" +
        encodeURIComponent(String(lng)),
      method: "GET",
      headers: { "User-Agent": NOMINATIM_USER_AGENT },
      timeout: 8,
    });
  } catch {
    return null;
  }
  if (!response || response.statusCode !== 200) return null;
  let result;
  try {
    result = response.json;
  } catch {
    return null;
  }
  const address = result && result.address ? result.address : null;
  if (!address) return null;
  const city =
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    address.city_district ||
    address.county ||
    "";
  if (!city) return null;
  return {
    city: String(city).slice(0, 120),
    country: String(address.country || "").slice(0, 120),
  };
}

/**
 * A pasted link as far as it can be read: `{ resolved, name, city, address, lat,
 * lng }`.
 *
 * Never throws for an unreadable link and never returns a partial answer the
 * caller has to guess about — `resolved: false` means the member's form should
 * be left exactly as they left it.
 */
function resolvePlaceLink(value, options) {
  const settings = options || {};
  const url = normalizeLink(value);
  if (!url) return { resolved: false };

  // Reading comes before fetching: a URL that already names a place is answered
  // without touching the network, so the redirect hop is spent only on the links
  // that genuinely need it. This is also what keeps `maps.google.com/?q=Name`
  // — short-link host, long-link content — off the wire.
  let parsed = parseMapLink(url);
  if (!parsed && isShortLink(url)) {
    const expanded = expandShortLink(url);
    if (expanded) parsed = parseMapLink(expanded);
    // Following the link can land on a page that names nothing — the
    // JavaScript shell, or a consent page. The preview rendering is the
    // remaining way to ask, and the last one.
    if (!parsed) parsed = previewPlaceFrom(url);
  }
  if (!parsed) return { resolved: false };

  let city = "";
  let country = "";
  if (settings.withCity !== false && parsed.lat !== null && parsed.lng !== null) {
    const located = cityFromCoordinates(parsed.lat, parsed.lng);
    if (located) {
      city = located.city;
      country = located.country;
    }
  }

  return {
    resolved: true,
    name: parsed.name || "",
    address: streetPartOf(parsed.address, city, country),
    city: city,
    country: country,
    lat: parsed.lat,
    lng: parsed.lng,
  };
}

/**
 * The address without the city and country already travelling beside it.
 *
 * Google writes the whole postal address into the name segment, so the string
 * that arrives here is "12 Rue Royale, 74000 Annecy, France" while `city` and
 * `country` are about to be sent as their own fields. The geocoder that
 * validates this builds its query as address, city, country — so leaving them
 * in asks it to look up Annecy twice, which is how a good address turns into a
 * failed match.
 */
function streetPartOf(address, city, country) {
  const parts = String(address || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return "";
  const cityKey = normalizeForCompare(city);
  const countryKey = normalizeForCompare(country);
  const kept = [];
  for (const part of parts) {
    const key = normalizeForCompare(part);
    if (!key) continue;
    if (cityKey && key === cityKey) continue;
    if (countryKey && key === countryKey) continue;
    // "74000 Annecy" is the city with its postcode welded on; the number is
    // worth keeping, the repeated city name is not.
    if (cityKey && key === "" + cityKey) continue;
    const withoutPostcode = key.replace(/^\d{3,6}\s+/, "");
    if (cityKey && withoutPostcode === cityKey) {
      const postcode = /^(\d{3,6})\s+/.exec(part.trim());
      if (postcode) kept.push(postcode[1]);
      continue;
    }
    kept.push(part);
  }
  return kept.join(", ").slice(0, 300);
}

function normalizeForCompare(value) {
  let text = String(value || "");
  if (typeof text.normalize === "function") {
    text = text.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  }
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

module.exports = {
  cityFromCoordinates,
  expandShortLink,
  isShortLink,
  normalizeLink,
  parseMapLink,
  previewPlaceFrom,
  resolvePlaceLink,
  streetPartOf,
};
