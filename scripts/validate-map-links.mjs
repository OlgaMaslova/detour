/**
 * The map-link parser, against the link shapes people actually paste.
 *
 * `pb_hooks/map_links.js` runs inside PocketBase's JavaScript VM, where there is
 * no test runner and a mistake surfaces as a member's paste quietly doing
 * nothing. This exercises the pure parsing half directly, and the resolving half
 * against a stubbed `$http`, so both can be checked without a server, a network,
 * or a real Google link that will rot.
 *
 *   node scripts/validate-map-links.mjs
 *
 * The rule every case here encodes: a link that cannot be read must return
 * nothing rather than a guess, because the caller is expected to leave whatever
 * the member typed alone.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

// The module reaches for PocketBase globals only inside the network paths; the
// parser needs neither, and the stubs below stand in for both when it does.
const calls = [];
globalThis.$os = { getenv: () => '' };
globalThis.$http = {
  send(options) {
    calls.push(options.url);
    if (options.url.includes('goo.gl')) {
      return {
        statusCode: 200,
        headers: {},
        raw:
          '<HTML><HEAD><TITLE>Moved</TITLE></HEAD><BODY>The document has moved <A HREF=' +
          '"https://www.google.com/maps/place/Morri%C3%B1a+D&#39;Gozo/@43.3623,-8.4115,17z/' +
          'data=!4m6!3m5!8m2!3d43.3620!4d-8.4110">here</A>.</BODY></HTML>',
      };
    }
    if (options.url.includes('/reverse')) {
      return { statusCode: 200, json: { address: { city: 'A Coruña', country: 'Spain' } } };
    }
    return null;
  },
};

/**
 * PocketBase hook files are CommonJS and this repo's package.json declares ES
 * modules, so Node refuses to `require` one by path. Evaluating the source with
 * its own `module`/`exports` is how the file gets loaded the way PocketBase
 * loads it, without renaming it to `.cjs` and breaking the hook.
 */
function loadHookModule(relativePath) {
  const source = readFileSync(path.join(here, '..', relativePath), 'utf8');
  const shell = { exports: {} };
  new Function('module', 'exports', source)(shell, shell.exports);
  return shell.exports;
}

const links = loadHookModule('pb_hooks/map_links.js');

let failures = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.error(`FAIL  ${label}`);
    console.error(`      expected ${JSON.stringify(expected)}`);
    console.error(`      actual   ${JSON.stringify(actual)}`);
    return;
  }
  console.log(`ok    ${label}`);
}

function parsed(url) {
  const result = links.parseMapLink(url);
  if (!result) return null;
  return { name: result.name, lat: result.lat, lng: result.lng };
}

// A desktop share: the pin in `data=` wins over the viewport in `@`.
check('desktop place link', parsed(
  'https://www.google.com/maps/place/Bar+Brutal/@41.3825,2.1656,17z/data=!4m6!3m5!8m2!3d41.3830!4d2.1660'
), { name: 'Bar Brutal', lat: 41.383, lng: 2.166 });

// Google appends the postal address to the name segment often enough that the
// first comma-separated part has to be treated as the name.
check('name with address appended', parsed(
  'https://www.google.com/maps/place/La+Source,+12+Rue+Royale,+74000+Annecy,+France/@45.8992,6.1294,17z/'
), { name: 'La Source', lat: 45.8992, lng: 6.1294 });

// A real 2026 share link, kept verbatim: the `187m` zoom suffix, the feature id
// in `!16s`, and the `entry`/`g_ep` tracking parameters are all shapes that have
// to survive being ignored.
check('live share link, verbatim', parsed(
  'https://www.google.com/maps/place/Cafe+Bunna/@45.8989444,6.1244942,187m/data=!3m1!1e3!4m6!3m5' +
  '!1s0x478b8ff97b2da793:0x9df87e8591267357!8m2!3d45.899046!4d6.125073!16s%2Fg%2F11cn7fn2_c' +
  '?entry=ttu&g_ep=EgoyMDI2MDcyOS4wIKXMDSoASAFQAw%3D%3D'
), { name: 'Cafe Bunna', lat: 45.899046, lng: 6.125073 });

// Twice-encoded, as a link that came back through the consent page is: the
// space in the name reaches the parser as %2B, not as +.
check('double-encoded name', parsed(
  'https://www.google.com/maps/place/Cafe%2BBunna/@45.899046,6.125073,17z'
), { name: 'Cafe Bunna', lat: 45.899046, lng: 6.125073 });

check('percent-encoded accents', parsed(
  'https://www.google.com/maps/place/Caf%C3%A9%20de%20Flore/@48.8542,2.3325,17z/'
), { name: 'Café de Flore', lat: 48.8542, lng: 2.3325 });

check('maps urls api query form', parsed(
  'https://www.google.com/maps/search/?api=1&query=Tartine+Bakery'
), { name: 'Tartine Bakery', lat: null, lng: null });

check('apple maps', parsed(
  'https://maps.apple.com/?q=60+Seconds+to+Napoli&ll=52.5200,13.4050'
), { name: '60 Seconds to Napoli', lat: 52.52, lng: 13.405 });

check('link pasted without a scheme', parsed(
  'www.google.com/maps/place/Brash+Coffee/@33.7490,-84.3880,17z/'
), { name: 'Brash Coffee', lat: 33.749, lng: -84.388 });

// A plus code is a coordinate spelled out, so it must not become a place name.
check('plus code is not a name', parsed(
  'https://www.google.com/maps/place/9F4M+2X+Berlin/@52.52,13.40,17z/'
), { name: '', lat: 52.52, lng: 13.4 });

check('unresolved short link', parsed('https://maps.app.goo.gl/aBcD1234'), null);
check('directions are not a place', parsed('https://www.google.com/maps/dir/A/B'), null);
check('prose is not a link', parsed('just where I keep going back to'), null);
check('empty', parsed(''), null);

// Resolution: the short link is followed, the escaped apostrophe survives it,
// and the city comes from the coordinates rather than from the member.
calls.length = 0;
const short = links.resolvePlaceLink('https://maps.app.goo.gl/aBcD1234');
check('short link resolves', { name: short.name, city: short.city, lat: short.lat }, {
  name: "Morriña D'Gozo",
  city: 'A Coruña',
  lat: 43.362,
});

// A URL that already names a place must not cost a request, even on a host whose
// other link shapes are redirects.
calls.length = 0;
const long = links.resolvePlaceLink('https://maps.google.com/?q=Trick+Dog,+San+Francisco', {
  withCity: false,
});
check('long link needs no request', { name: long.name, requests: calls.length }, {
  name: 'Trick Dog',
  requests: 0,
});

calls.length = 0;
check('unreadable paste asks for nothing', {
  ...links.resolvePlaceLink('just some text'),
  requests: calls.length,
}, { resolved: false, requests: 0 });

/**
 * The shapes a short link can hide its destination in.
 *
 * PocketBase's HTTP client follows redirects without saying where it went, so
 * the destination has to be recovered from the body — and Google writes it
 * differently depending on who is asking and from where. Each of these is a real
 * response shape, and each one used to defeat a plain URL match.
 */
const bodies = {
  'consent page, percent-encoded': `<a href="https://consent.google.com/m?continue=` +
    `https%3A%2F%2Fwww.google.com%2Fmaps%2Fplace%2FLa%2BSource%2F%4045.8992%2C6.1294%2C17z` +
    `&gl=FR">Continue</a>`,
  'og:url on a rendered page':
    '<meta property="og:url" content="https://www.google.com/maps/place/La+Source/@45.8992,6.1294,17z">',
  'escaped slashes in page data':
    '{"url":"https:\\/\\/www.google.com\\/maps\\/place\\/La+Source\\/@45.8992,6.1294,17z"}',
};

for (const [label, html] of Object.entries(bodies)) {
  globalThis.$http.send = () => ({ statusCode: 200, headers: {}, raw: html });
  const expanded = links.expandShortLink('https://maps.app.goo.gl/whatever');
  check(label, parsed(expanded), { name: 'La Source', lat: 45.8992, lng: 6.1294 });
}

// A page that names no place must expand to nothing rather than to a guess.
globalThis.$http.send = () => ({
  statusCode: 200,
  headers: {},
  raw: '<html><body><script>window.location="https://www.google.com/search?q=x"</script></body></html>',
});
check('page with no place', links.expandShortLink('https://maps.app.goo.gl/whatever'), '');

// The consent interstitial carries the destination as a hidden form value.
globalThis.$http.send = () => ({
  statusCode: 200,
  headers: {},
  raw:
    '<html lang="de"><body><form action="https://consent.google.com/save" method="POST">' +
    '<input type="hidden" name="continue" value="https://www.google.com/maps/place/La+Source/@45.8992,6.1294,17z?entry=tts&amp;g_ep=abc">' +
    '<button>Alle akzeptieren</button></form></body></html>',
});
check('consent form hidden continue', parsed(links.expandShortLink('https://maps.app.goo.gl/whatever')), {
  name: 'La Source',
  lat: 45.8992,
  lng: 6.1294,
});

/**
 * When every rendering of the destination hides it, the preview page is the
 * remaining witness: the JavaScript shell for browsers, the caption page for
 * bots. The resolver must fall through to it and come back with the name.
 */
globalThis.$http.send = (options) => {
  const agent = String((options.headers || {})['User-Agent'] || '');
  if (/facebookexternalhit|Twitterbot/i.test(agent)) {
    return {
      statusCode: 200,
      headers: {},
      raw:
        '<html><head>' +
        '<meta content="Cafe Bunna · Google Maps" property="og:title">' +
        '<meta content="12 Rue Royale, 74000 Annecy, France" property="og:description">' +
        '<meta content="https://maps.googleapis.com/maps/api/staticmap?center=45.899046%2C6.125073&zoom=17" property="og:image">' +
        '</head><body></body></html>',
    };
  }
  if (options.url.includes('/reverse')) {
    return { statusCode: 200, json: { address: { city: 'Annecy', country: 'France' } } };
  }
  // Browsers get the shell that names nothing.
  return {
    statusCode: 200,
    headers: {},
    raw: '<html lang="de"><body><a href="https://support.google.com/maps/?p=no_javascript">Enable JavaScript</a></body></html>',
  };
};
const viaPreview = links.resolvePlaceLink('https://maps.app.goo.gl/7N2fagVZfk64ur4Q9');
check('shell falls through to preview', {
  name: viaPreview.name,
  city: viaPreview.city,
  lat: viaPreview.lat,
}, { name: 'Cafe Bunna', city: 'Annecy', lat: 45.899046 });

/**
 * The street, once the city and country have been lifted out of it.
 *
 * Google writes the whole postal address into the name segment while city and
 * country travel as their own fields, and the geocoder that validates all three
 * concatenates them — so anything left duplicated here is asked for twice and
 * matches worse than a plain street would.
 */
check('street keeps the postcode, drops the city',
  links.streetPartOf('12 Rue Royale, 74000 Annecy, France', 'Annecy', 'France'),
  '12 Rue Royale, 74000');
check('street with accents compares past them',
  links.streetPartOf('5 Carrer de Barbarà, 08001 Barcelona, Spain', 'Barcelona', 'Spain'),
  '5 Carrer de Barbarà, 08001');
check('street with nothing to drop is untouched',
  links.streetPartOf('3010 20th St', 'San Francisco', 'United States'),
  '3010 20th St');
check('address that was only a city empties out',
  links.streetPartOf('Annecy, France', 'Annecy', 'France'),
  '');

console.log(failures ? `\n${failures} failing` : '\nall map-link cases pass');
process.exit(failures ? 1 : 0);
