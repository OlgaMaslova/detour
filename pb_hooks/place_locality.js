// What a member means when they write "San Francisco, CA".
//
// Every place on Detour is located by a city and a country, and there is no
// field between them. Americans do not write cities that way — the state is part
// of how the place is named out loud — so "San Francisco, CA" arrives in the one
// box there is, and the whole string becomes the city.
//
// That one string breaks three things at once, quietly:
//
//   - citySlug() turns it into `san-francisco-ca`, a second city page standing
//     next to the real one, with the same places split between them.
//   - enrichVenueFromOsm and geocodeVenue both refuse a Nominatim hit whose city
//     does not match the claimed one. Nominatim answers "San Francisco"; the
//     claim says "San Francisco, Ca"; the match is thrown away. No coordinates,
//     no address, no country, no website — and no error anywhere, because
//     withholding an unconfirmed pin is exactly what that guard is for.
//   - `country` stays empty, so the Nominatim query loses the one term that
//     would have disambiguated the city in the first place.
//
// So the state is read here and taken off the city, and it is not stored: the
// catalogue is city + country, and adding a third rung would mean a region on
// every collection, a slug that carries it, and a city identity keyed on it.
// What the state is *for* is the country — "CA" is the only evidence in
// "San Francisco, CA" that this is not the one in Córdoba — and the country is
// a field we already have, already display, and already put in the geocoder
// query. Read it, spend it, drop it.
//
// The same reading handles a trailing country ("Paris, France") and a trailing
// postcode ("San Francisco, CA 94110"), because they arrive through the same box
// for the same reason.
//
// Require this module from inside every hook callback; PocketBase isolates
// handler callbacks from hook-file module scope.

// US postal abbreviations, plus DC and the territories that use the same form.
// Keyed by both the code and the spelled-out name, since a member who does not
// abbreviate still means the same thing.
const US_STATES = {
  al: "AL", alabama: "AL",
  ak: "AK", alaska: "AK",
  az: "AZ", arizona: "AZ",
  ar: "AR", arkansas: "AR",
  ca: "CA", california: "CA",
  co: "CO", colorado: "CO",
  ct: "CT", connecticut: "CT",
  de: "DE", delaware: "DE",
  dc: "DC", "district of columbia": "DC", "washington dc": "DC",
  fl: "FL", florida: "FL",
  ga: "GA",
  hi: "HI", hawaii: "HI",
  id: "ID", idaho: "ID",
  il: "IL", illinois: "IL",
  in: "IN", indiana: "IN",
  ia: "IA", iowa: "IA",
  ks: "KS", kansas: "KS",
  ky: "KY", kentucky: "KY",
  la: "LA", louisiana: "LA",
  me: "ME", maine: "ME",
  md: "MD", maryland: "MD",
  ma: "MA", massachusetts: "MA",
  mi: "MI", michigan: "MI",
  mn: "MN", minnesota: "MN",
  ms: "MS", mississippi: "MS",
  mo: "MO", missouri: "MO",
  mt: "MT", montana: "MT",
  ne: "NE", nebraska: "NE",
  nv: "NV", nevada: "NV",
  nh: "NH", "new hampshire": "NH",
  nj: "NJ", "new jersey": "NJ",
  nm: "NM", "new mexico": "NM",
  ny: "NY", "new york": "NY", "new york state": "NY",
  nc: "NC", "north carolina": "NC",
  nd: "ND", "north dakota": "ND",
  oh: "OH", ohio: "OH",
  ok: "OK", oklahoma: "OK",
  or: "OR", oregon: "OR",
  pa: "PA", pennsylvania: "PA",
  ri: "RI", "rhode island": "RI",
  sc: "SC", "south carolina": "SC",
  sd: "SD", "south dakota": "SD",
  tn: "TN", tennessee: "TN",
  tx: "TX", texas: "TX",
  ut: "UT", utah: "UT",
  vt: "VT", vermont: "VT",
  va: "VA", virginia: "VA",
  wa: "WA", washington: "WA", "washington state": "WA",
  wv: "WV", "west virginia": "WV",
  wi: "WI", wisconsin: "WI",
  wy: "WY", wyoming: "WY",
  pr: "PR", "puerto rico": "PR",
  vi: "VI", "us virgin islands": "VI",
  gu: "GU", guam: "GU",
};

const CA_PROVINCES = {
  ab: "AB", alberta: "AB",
  bc: "BC", "british columbia": "BC",
  mb: "MB", manitoba: "MB",
  nb: "NB", "new brunswick": "NB",
  nl: "NL", "newfoundland and labrador": "NL", newfoundland: "NL",
  ns: "NS", "nova scotia": "NS",
  nt: "NT", "northwest territories": "NT",
  nu: "NU", nunavut: "NU",
  on: "ON", ontario: "ON",
  pe: "PE", "prince edward island": "PE",
  qc: "QC", quebec: "QC",
  sk: "SK", saskatchewan: "SK",
  yt: "YT", yukon: "YT",
};

// Both a US state and a sovereign country, and nothing in "Atlanta, Georgia" or
// "Tbilisi, Georgia" says which. The tail is still taken off the city — that
// part is unambiguous, and leaving it on is what forks the city page — but no
// country is inferred from it. Nominatim resolves the bare city name correctly
// in both directions, which is more than a coin flip here would.
const AMBIGUOUS_TAILS = { georgia: true };

// ISO 3166-1 English short names, mirroring src/countries.ts, so a country read
// off a city line is spelled the way the rest of the app spells it.
const COUNTRY_NAMES = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda",
  "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain",
  "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan",
  "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria",
  "Burkina Faso", "Burundi", "Cabo Verde", "Cambodia", "Cameroon", "Canada",
  "Central African Republic", "Chad", "Chile", "China", "Colombia", "Comoros",
  "Congo", "Congo (Democratic Republic)", "Costa Rica", "Côte d’Ivoire", "Croatia",
  "Cuba", "Cyprus", "Czechia", "Denmark", "Djibouti", "Dominica", "Dominican Republic",
  "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia",
  "Eswatini", "Ethiopia", "Fiji", "Finland", "France", "Gabon", "Gambia", "Georgia",
  "Germany", "Ghana", "Greece", "Grenada", "Guatemala", "Guinea", "Guinea-Bissau",
  "Guyana", "Haiti", "Honduras", "Hong Kong", "Hungary", "Iceland", "India",
  "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy", "Jamaica", "Japan",
  "Jordan", "Kazakhstan", "Kenya", "Kiribati", "Kosovo", "Kuwait", "Kyrgyzstan",
  "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein",
  "Lithuania", "Luxembourg", "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali",
  "Malta", "Marshall Islands", "Mauritania", "Mauritius", "Mexico", "Micronesia",
  "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique", "Myanmar",
  "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger",
  "Nigeria", "North Korea", "North Macedonia", "Norway", "Oman", "Pakistan", "Palau",
  "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines",
  "Poland", "Portugal", "Qatar", "Romania", "Russia", "Rwanda", "Saint Kitts and Nevis",
  "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa", "San Marino",
  "São Tomé and Príncipe", "Saudi Arabia", "Senegal", "Serbia", "Seychelles",
  "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Solomon Islands", "Somalia",
  "South Africa", "South Korea", "South Sudan", "Spain", "Sri Lanka", "Sudan",
  "Suriname", "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan", "Tanzania",
  "Thailand", "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia",
  "Turkey", "Turkmenistan", "Tuvalu", "Uganda", "Ukraine", "United Arab Emirates",
  "United Kingdom", "United States", "Uruguay", "Uzbekistan", "Vanuatu",
  "Vatican City", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe",
];

// What people actually type where a country goes. The constituent countries of
// the UK are here because "Edinburgh, Scotland" is how that address is written
// and "Scotland" is not an ISO short name.
const COUNTRY_ALIASES = {
  usa: "United States",
  us: "United States",
  "u s a": "United States",
  "u s": "United States",
  america: "United States",
  "united states of america": "United States",
  uk: "United Kingdom",
  "u k": "United Kingdom",
  "great britain": "United Kingdom",
  britain: "United Kingdom",
  england: "United Kingdom",
  scotland: "United Kingdom",
  wales: "United Kingdom",
  "northern ireland": "United Kingdom",
  holland: "Netherlands",
  "the netherlands": "Netherlands",
  uae: "United Arab Emirates",
  "czech republic": "Czechia",
  "south korea": "South Korea",
  korea: "South Korea",
  "ivory coast": "Côte d’Ivoire",
  "cape verde": "Cabo Verde",
  turkiye: "Turkey",
  "türkiye": "Turkey",
  burma: "Myanmar",
  swaziland: "Eswatini",
  macedonia: "North Macedonia",
  "hong kong sar": "Hong Kong",
  "vatican": "Vatican City",
  "russian federation": "Russia",
};

/** The lookup form of a locality word: caseless, unaccented, unpunctuated. */
function localityKey(value) {
  let text = String(value === undefined || value === null ? "" : value);
  if (typeof text.normalize === "function") {
    text = text.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  }
  return text
    .toLowerCase()
    .replace(/[’'`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every country name and alias, keyed for lookup. Built once per require. */
const COUNTRIES_BY_KEY = (function () {
  const table = {};
  for (const name of COUNTRY_NAMES) table[localityKey(name)] = name;
  for (const alias of Object.keys(COUNTRY_ALIASES)) {
    table[localityKey(alias)] = COUNTRY_ALIASES[alias];
  }
  return table;
})();

/**
 * What a trailing comma-part of a city line turns out to be, or null when it is
 * not a state, a province, a country or a postcode — in which case it is part of
 * the place's name for the city and stays where it is.
 *
 * A postcode welded onto a state ("CA 94110") is read as the state: the number
 * is the one part of an address nobody needs here, and dropping it is what lets
 * the state be seen at all.
 */
function readLocalityTail(value) {
  let text = String(value || "").trim();
  if (!text) return { region: "", country: "" };
  // A bare postcode, US ZIP+4, or UK-style outward/inward pair.
  if (/^\d{3,10}(-\d{4})?$/.test(text) || /^[A-Za-z]{1,2}\d[\dA-Za-z]?\s*\d[A-Za-z]{2}$/.test(text)) {
    return { region: "", country: "" };
  }
  // A postcode riding along behind something else — "CA 94110", "NY 10011".
  text = text.replace(/\s+\d{3,10}(-\d{4})?$/, "").trim();
  const key = localityKey(text);
  if (!key) return { region: "", country: "" };
  if (AMBIGUOUS_TAILS[key]) return { region: "", country: "" };
  if (US_STATES[key]) return { region: US_STATES[key], country: "United States" };
  if (CA_PROVINCES[key]) return { region: CA_PROVINCES[key], country: "Canada" };
  if (COUNTRIES_BY_KEY[key]) return { region: "", country: COUNTRIES_BY_KEY[key] };
  return null;
}

/**
 * A city line and a country as the two facts the catalogue stores:
 * `{ city, region, country }`.
 *
 * "San Francisco, CA"           → San Francisco / CA / United States
 * "San Francisco, CA 94110"     → San Francisco / CA / United States
 * "Brooklyn, New York"          → Brooklyn      / NY / United States
 * "Toronto, ON"                 → Toronto       / ON / Canada
 * "Paris, France"               → Paris         / "" / France
 * "Tbilisi, Georgia"            → Tbilisi       / "" / "" (see AMBIGUOUS_TAILS)
 * "Stoke Newington, London"     → unchanged — London is not a state or country
 *
 * A supplied country always wins: the member's own answer, or a catalogue
 * venue's settled fact, is not overruled by a guess read off a city line.
 *
 * `region` is returned for callers that want it for a lookup, and deliberately
 * has nowhere to be stored. Never invents a city: if taking the tails off would
 * leave nothing, the whole line is handed back untouched.
 */
function splitLocality(rawCity, rawCountry) {
  const suppliedCountry = String(rawCountry === undefined || rawCountry === null ? "" : rawCountry).trim();
  const original = String(rawCity === undefined || rawCity === null ? "" : rawCity).trim();
  const parts = original.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    return { city: original, region: "", country: suppliedCountry };
  }

  let region = "";
  let readCountry = "";
  while (parts.length > 1) {
    const read = readLocalityTail(parts[parts.length - 1]);
    if (!read) break;
    parts.pop();
    if (!region && read.region) region = read.region;
    if (!readCountry && read.country) readCountry = read.country;
  }

  const city = parts.join(", ").trim();
  if (city.length < 2) {
    return { city: original, region: "", country: suppliedCountry };
  }
  return { city, region, country: suppliedCountry || readCountry };
}

module.exports = { localityKey, readLocalityTail, splitLocality };
