/**
 * What a short map link actually returns, from this machine, on this network.
 *
 * The place-link reader lives server-side, where the HTTP client follows
 * redirects without saying where it went — so when a link fails to resolve, the
 * question is always "what did Google serve *us*?", and the answer differs by
 * IP, region, and user agent. This asks for real, three ways, and then runs the
 * production module itself over a live HTTP shim so the verdict is the code's,
 * not a reimplementation's.
 *
 *   node scripts/debug-map-link.mjs https://maps.app.goo.gl/XXXX
 *
 * Reads nothing but the URL given and prints what it finds; changes nothing.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/debug-map-link.mjs <map link>');
  process.exit(2);
}

const AGENTS = {
  'mobile safari':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'preview bot (facebook)': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'preview bot (twitter)': 'Twitterbot/1.0',
};

function loadHookModule(relativePath) {
  const source = readFileSync(path.join(here, '..', relativePath), 'utf8');
  const shell = { exports: {} };
  new Function('module', 'exports', source)(shell, shell.exports);
  return shell.exports;
}

function snippetAround(body, pattern, width = 160) {
  const match = pattern.exec(body);
  if (!match) return '';
  const start = Math.max(0, match.index - 40);
  return body.slice(start, start + width).replace(/\s+/g, ' ');
}

// --- Part one: what each audience is served, per Node (which names the final URL).
for (const [label, agent] of Object.entries(AGENTS)) {
  let response;
  try {
    response = await fetch(target, {
      redirect: 'follow',
      headers: { 'User-Agent': agent, 'Accept-Language': 'en', Accept: 'text/html,*/*;q=0.8' },
    });
  } catch (error) {
    console.log(`\n[${label}] request failed: ${error}`);
    continue;
  }
  const body = await response.text();
  console.log(`\n[${label}]`);
  console.log(`  status     ${response.status}`);
  console.log(`  final url  ${response.url}`);
  console.log(`  body       ${body.length} chars, lang=${/<html[^>]*lang=["']([^"']*)/i.exec(body)?.[1] || '?'}`);
  const ogTitle = /<meta[^>]+og:title[^>]+content=["']([^"']*)/i.exec(body)?.[1]
    || /<meta[^>]+content=["']([^"']*)["'][^>]*og:title/i.exec(body)?.[1] || '';
  console.log(`  og:title   ${ogTitle || '(none)'}`);
  console.log(`  map url in body   ${snippetAround(body, /https?:\/\/[^"'\s<>]*\/maps\/place\/[^"'\s<>]{0,80}/i) || '(none)'}`);
  console.log(`  consent continue  ${snippetAround(body, /name=["']continue["']/i) || '(none)'}`);
}

// --- Part two: the production module, verbatim, over live HTTP.
globalThis.$os = { getenv: () => '' };
globalThis.$http = {
  send(options) {
    // The module runs synchronously; a child process is the plainest way to
    // give it a synchronous fetch without rewriting it for this script.
    const script = `
      const [url, headers] = [process.argv[1], JSON.parse(process.argv[2])];
      fetch(url, { redirect: 'follow', headers }).then(async (r) => {
        process.stdout.write(JSON.stringify({ statusCode: r.status, raw: await r.text(), headers: {} }));
      }).catch(() => process.stdout.write(JSON.stringify({ statusCode: 0, raw: '', headers: {} })));
    `;
    try {
      const out = execFileSync(process.execPath, ['-e', script, options.url, JSON.stringify(options.headers || {})], {
        timeout: (options.timeout || 8) * 1000,
        maxBuffer: 16 * 1024 * 1024,
      });
      const parsed = JSON.parse(String(out));
      parsed.json = undefined;
      try { parsed.json = JSON.parse(parsed.raw); } catch { /* not json */ }
      return parsed;
    } catch {
      return { statusCode: 0, raw: '', headers: {} };
    }
  },
};
const links = loadHookModule('pb_hooks/map_links.js');
console.log('\n[production module, live]');
console.log(' ', JSON.stringify(links.resolvePlaceLink(target), null, 2).replace(/\n/g, '\n  '));
