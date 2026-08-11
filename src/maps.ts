/**
 * Every map on Detour: the city board's, the place detail's locator, and the two
 * providers that can draw them.
 *
 * This module owns the map layer end to end. Routing, state and escaping stay in
 * main.ts, which hands in what a pin needs to be clickable — the same split
 * place.ts and network.ts use, and the reason nothing here imports main.ts.
 *
 * TWO PROVIDERS, ONE SURFACE. With `VITE_GOOGLE_MAPS_API_KEY` set the maps are
 * Google's; without it they fall back to Leaflet over OpenStreetMap tiles, which
 * needs no key, no account and no card. That is what a fresh checkout gets, and
 * it is a working map rather than an empty frame — the alternative was a repo
 * whose maps only exist for whoever holds the key.
 *
 * The choice is made once, at module load, from a build-time constant. Leaflet is
 * imported dynamically so a keyed production bundle never carries a map library
 * it will not use.
 *
 * Everything below the public surface at the bottom of this file is one provider
 * or the other. The exports are identical either way, so main.ts never learns
 * which is running.
 */

import type { Map as LeafletMap } from 'leaflet';
import type { Venue } from './data';
import type { BoardPlace } from './community';
import { PLACE_MAP_ID } from './place';

const env = (import.meta as ImportMeta & {
  env: { VITE_GOOGLE_MAPS_API_KEY?: string; VITE_GOOGLE_MAPS_MAP_ID?: string };
}).env;

const apiKey = env.VITE_GOOGLE_MAPS_API_KEY || '';

/** Google when there is a key to authenticate with, OpenStreetMap otherwise. */
const useGoogle = Boolean(apiKey);

/**
 * The styled map Google draws on. A map ID is not decoration: advanced markers
 * refuse to render without one, and it is also where the tape palette lives,
 * cloud styling being the only way to recolour a Google map. Google's development
 * ID is the fallback so a checkout with a key but no styled map still shows pins —
 * unstyled, and not fit for production.
 */
const mapId = env.VITE_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID';

// Mounting is asynchronous under both providers — a script or a chunk has to
// arrive first — so a render that has since been replaced must not finish
// mounting into a container that is no longer on the page. Each mount takes a
// ticket and drops out if it is stale.
let boardMounting = 0;
let locatorMounting = 0;

// Which pins the board is showing, for the Google path: the view refits when this
// changes, because the whole point of the chips is that "Chelsea, still to try"
// zooms to Chelsea, and is otherwise left where the member left it.
let savedPinKey = '';

/** Forget the fitted view, so the next board mount refits. */
export function resetBoardView(): void {
  savedPinKey = '';
}

/* ========================= Google Maps ========================= */

/** The pieces of the API this module uses, resolved after the script loads. */
interface MapsLibrary {
  Map: typeof google.maps.Map;
  LatLngBounds: typeof google.maps.LatLngBounds;
  AdvancedMarkerElement: typeof google.maps.marker.AdvancedMarkerElement;
}

const CALLBACK = '__detourGoogleMapsReady';

let googlePending: Promise<MapsLibrary | null> | null = null;

/**
 * The Maps script, loaded once for whichever map asks first.
 *
 * A document may only take this script once, and both maps share it, so the
 * promise is cached: the second caller waits on the first one's load rather than
 * appending a second tag.
 *
 * It resolves to `null` rather than throwing when the script does not arrive. A
 * map is an aid to a page that already says where a place is in words — the
 * address is in the markup, the directions link beside it — so a blocked CDN or
 * an exhausted quota leaves an empty frame on a page that otherwise works.
 * Nothing here may blank a route.
 */
function loadGoogleMaps(): Promise<MapsLibrary | null> {
  if (googlePending) return googlePending;

  googlePending = new Promise<MapsLibrary | null>((resolve) => {
    const globals = window as unknown as Record<string, unknown>;
    globals[CALLBACK] = () => {
      delete globals[CALLBACK];
      resolve({
        Map: google.maps.Map,
        LatLngBounds: google.maps.LatLngBounds,
        AdvancedMarkerElement: google.maps.marker.AdvancedMarkerElement,
      });
    };
    const script = document.createElement('script');
    // `loading=async` is what Google asks for alongside the callback form; the
    // marker library carries AdvancedMarkerElement, which every pin here is.
    script.src =
      'https://maps.googleapis.com/maps/api/js' +
      `?key=${encodeURIComponent(apiKey)}` +
      '&v=weekly&libraries=maps,marker&loading=async' +
      `&callback=${CALLBACK}`;
    script.async = true;
    script.addEventListener('error', () => {
      delete globals[CALLBACK];
      resolve(null);
    });
    document.head.append(script);
  });

  return googlePending;
}

/**
 * A Google map that outlives the render which first put it on screen.
 *
 * The whole root is re-rendered on every state change, so the container a map was
 * mounted into is thrown away constantly. Under Leaflet the answer is to destroy
 * the map and build the next one — free, and the simplest thing that works. Under
 * Google it is not free: every `new google.maps.Map()` is a billed map load, and
 * one member filtering a city board a dozen times would spend a dozen of them on
 * a map that never changed.
 *
 * So a Google map keeps its own `host` div, which this module owns and never
 * discards. A render moves that div into whichever container is on screen now; a
 * teardown lifts it back out. Pins are rebuilt each time, being free. The
 * instance — the billed part — is created once per session.
 */
interface LiveMap {
  /** The map's own element, re-parented between renders rather than rebuilt. */
  host: HTMLElement;
  map: google.maps.Map;
  markers: google.maps.marker.AdvancedMarkerElement[];
}

let googleBoard: LiveMap | null = null;
let googleLocator: LiveMap | null = null;

function clearMarkers(live: LiveMap): void {
  for (const marker of live.markers) marker.map = null;
  live.markers = [];
}

/**
 * Take a Google map off screen without giving up the instance.
 *
 * Detaching the host leaves the `LiveMap` in module state with its map alive and
 * ready for the next mount. The markers go, because the next mount is about some
 * other set of places.
 */
function detachMap(live: LiveMap | null): void {
  if (!live) return;
  clearMarkers(live);
  live.host.remove();
}

/**
 * A Google map in a container, built once and thereafter only moved.
 *
 * Every Leaflet option the other path uses has a counterpart. Cooperative gesture
 * handling is what `scrollWheelZoom: false` is for — the page keeps its scroll and
 * ⌘/ctrl-wheel zooms — and the controls this design never asked for are off.
 * Fractional zoom is native here, so `zoomSnap` has nothing to translate into.
 *
 * The host is appended before the map is constructed, not after: a map built
 * against a detached element has no size to lay itself out in and comes up grey.
 */
function createLiveMap(
  lib: MapsLibrary,
  container: HTMLElement,
  center: google.maps.LatLngLiteral,
  zoom: number
): LiveMap {
  const host = document.createElement('div');
  host.className = 'gmap-host';
  container.append(host);
  const map = new lib.Map(host, {
    mapId,
    center,
    zoom,
    gestureHandling: 'cooperative',
    // Explicit rather than left to the default: the place page's own label
    // promises "zoom controls inside", so this is a contract, not a preference.
    zoomControl: true,
    // The vector-map tilt and rotate widget, which this design never asked for —
    // a flat map is the whole look, and there is nothing here to see in 3D.
    rotateControl: false,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    clickableIcons: false,
  });
  return { host, map, markers: [] };
}

function attachMap(live: LiveMap, container: HTMLElement): void {
  if (live.host.parentElement !== container) container.append(live.host);
}

/**
 * A pin's DOM, wrapped so the coordinate lands where the CSS expects it.
 *
 * Advanced markers put the bottom-centre of their content element on the
 * coordinate. Leaflet puts a zero-size box there and lets the pin centre itself
 * out of it with `position: absolute` and a half-size translate. A zero-size
 * wrapper makes the two anchoring models identical — the bottom-centre of nothing
 * is the coordinate itself — which is what lets one set of `.map-pin` and
 * `.board-pin` rules serve both providers.
 *
 * Pointer events are off here and switched back on by the pins themselves, so the
 * invisible wrapper never eats a drag meant for the map.
 */
function pinContent(html: string): HTMLElement {
  const anchor = document.createElement('div');
  anchor.className = 'gmap-pin-anchor';
  anchor.innerHTML = html;
  return anchor;
}

function googleMountPoint(container: HTMLElement, lat: number, lng: number): void {
  const ticket = locatorMounting;
  const center = { lat, lng };

  void loadGoogleMaps().then((lib) => {
    if (!lib || ticket !== locatorMounting || !container.isConnected) return;

    const live = googleLocator ?? createLiveMap(lib, container, center, 16);
    googleLocator = live;
    attachMap(live, container);
    clearMarkers(live);
    // Re-centring is also what re-sizes the map after a move between containers.
    live.map.setOptions({ center, zoom: 16 });

    live.markers.push(
      new lib.AdvancedMarkerElement({
        map: live.map,
        position: center,
        content: pinContent(LOCATOR_PIN_HTML),
        gmpClickable: false,
      })
    );
  });
}

function googleMountBoard(
  root: HTMLElement,
  container: HTMLElement,
  pins: BoardPlace[],
  hooks: BoardMapHooks
): void {
  const ticket = boardMounting;
  const center = { lat: pins[0].lat as number, lng: pins[0].lng as number };

  void loadGoogleMaps().then((lib) => {
    if (!lib || ticket !== boardMounting || !container.isConnected) return;

    const live = googleBoard ?? createLiveMap(lib, container, center, 13);
    googleBoard = live;
    attachMap(live, container);
    clearMarkers(live);

    const caption = root.querySelector<HTMLElement>('[data-board-caption]');
    for (const row of pins) {
      const marker = new lib.AdvancedMarkerElement({
        map: live.map,
        position: { lat: row.lat as number, lng: row.lng as number },
        content: pinContent(boardPinHtml(row, hooks)),
        // The pin handles its own clicks and keys. Going through Google's click
        // model instead would split the link semantics, the keyboard handling and
        // the row lighting across two places for no gain.
        gmpClickable: false,
      });
      live.markers.push(marker);

      const pin = (marker.content as HTMLElement | null)?.querySelector<HTMLElement>('.board-pin');
      if (!pin) continue;
      bindBoardPin(root, pin, row, hooks, caption, (on) => {
        // What Leaflet's `riseOnHover` does for us: a lit pin has to come out from
        // under its neighbours, and a z-index on the pin cannot lift the marker
        // element Google wraps it in.
        marker.zIndex = on ? 1 : 0;
      });
    }

    // Fitted to what is on screen rather than to the city. An unchanged set of
    // pins means nothing about this map changed, so the member's own pan and zoom
    // survive the re-render that brought us here.
    const pinKey = pins.map((row) => row.key).join('|');
    if (pinKey === savedPinKey) {
      const held = live.map.getCenter();
      if (held) live.map.setCenter(held);
      return;
    }
    savedPinKey = pinKey;

    const bounds = new lib.LatLngBounds();
    for (const row of pins) {
      bounds.extend({ lat: row.lat as number, lng: row.lng as number });
    }
    live.map.setOptions({ maxZoom: 15 });
    live.map.fitBounds(bounds, 40);
    // The cap was a fitting instruction, not a limit on the member: a single pin
    // would otherwise fill the frame with one street. Released once the fit has
    // been applied, so zooming further in is still theirs to do.
    google.maps.event.addListenerOnce(live.map, 'idle', () => {
      live.map.setOptions({ maxZoom: null });
    });
  });
}

/* ========================= Leaflet + OpenStreetMap ========================= */

const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

/** Leaflet's namespace — `L.map`, `L.marker` and the rest, as the types see it. */
type LeafletApi = typeof import('leaflet');

let leafletPending: Promise<LeafletApi> | null = null;

/**
 * Leaflet and its stylesheet, fetched only if this build is running without a
 * Google key. A keyed production bundle never pays for the library.
 *
 * The `default ?? mod` is interop, not superstition: Leaflet ships both an ESM
 * build with named exports and a UMD one whose whole API arrives as `default`,
 * and which of the two a bundler hands back is its decision rather than ours.
 */
function loadLeaflet(): Promise<LeafletApi> {
  if (!leafletPending) {
    leafletPending = Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]).then(
      ([mod]) => (mod as LeafletApi & { default?: LeafletApi }).default ?? mod
    );
  }
  return leafletPending;
}

// Leaflet maps are free to build, so unlike the Google path these are destroyed
// and rebuilt per render — which is what the surrounding code always did, and
// simpler than keeping an instance alive for no saving.
let leafletBoard: LeafletMap | null = null;
let leafletLocator: LeafletMap | null = null;

function leafletMountPoint(container: HTMLElement, lat: number, lng: number): void {
  const ticket = locatorMounting;

  void loadLeaflet().then((L) => {
    if (ticket !== locatorMounting || !container.isConnected) return;

    const map = L.map(container, {
      center: [lat, lng],
      zoom: 16,
      zoomControl: true,
      scrollWheelZoom: false,
      boxZoom: false,
    });
    leafletLocator = map;

    L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(map);
    L.marker([lat, lng], {
      icon: L.divIcon({
        className: '',
        html: LOCATOR_PIN_HTML,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }),
      keyboard: false,
      interactive: false,
    }).addTo(map);
  });
}

function leafletMountBoard(
  root: HTMLElement,
  container: HTMLElement,
  pins: BoardPlace[],
  hooks: BoardMapHooks
): void {
  const ticket = boardMounting;

  void loadLeaflet().then((L) => {
    if (ticket !== boardMounting || !container.isConnected) return;

    const map = L.map(container, {
      center: [pins[0].lat as number, pins[0].lng as number],
      zoom: 13,
      scrollWheelZoom: false, // don't hijack page scroll
      zoomSnap: 0.5,
    });
    leafletBoard = map;

    L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(map);

    const caption = root.querySelector<HTMLElement>('[data-board-caption]');
    for (const row of pins) {
      const marker = L.marker([row.lat as number, row.lng as number], {
        icon: L.divIcon({
          className: '',
          html: boardPinHtml(row, hooks),
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
        keyboard: false,
        riseOnHover: true,
      }).addTo(map);

      const el = marker.getElement();
      if (!el) continue;
      // The Leaflet marker root is zero-size; the inner pin is the real target.
      el.setAttribute('tabindex', '-1');
      el.removeAttribute('role');
      el.removeAttribute('aria-label');
      const pin = el.querySelector<HTMLElement>('.board-pin');
      if (!pin) continue;
      bindBoardPin(root, pin, row, hooks, caption);
    }

    // Fitted to what is on screen rather than to the city: the whole point of the
    // chips is that "Chelsea, still to try" zooms to Chelsea.
    const bounds = L.latLngBounds(
      pins.map((row) => [row.lat as number, row.lng as number] as [number, number])
    );
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  });
}

/* ========================= shared pin markup and wiring ========================= */

const LOCATOR_PIN_HTML = `<span class="map-pin pin-detourist pin-selected" aria-hidden="true">
        <span class="pin-pearl"><span class="pin-signal"></span></span>
      </span>`;

/**
 * No number on the pin: the rows lost theirs, and a numbered pin beside an
 * unnumbered list is a legend for a key that is not printed. It is a dot, and the
 * hover says which place it is.
 */
function boardPinHtml(row: BoardPlace, hooks: BoardMapHooks): string {
  return `<span class="board-pin${row.been ? ' is-been' : ''}" data-board-pin="${hooks.esc(row.key)}"></span>`;
}

/**
 * A pin becomes a link: same semantics, same keys, same row lighting, whichever
 * provider drew it.
 *
 * `rise` is the one thing the two cannot share. Leaflet lifts a hovered marker
 * itself; Google wraps the pin in an element whose stacking a CSS z-index on the
 * pin cannot reach, so that path passes a callback to set the marker's own.
 */
function bindBoardPin(
  root: HTMLElement,
  pin: HTMLElement,
  row: BoardPlace,
  hooks: BoardMapHooks,
  caption: HTMLElement | null,
  rise?: (on: boolean) => void
): void {
  pin.setAttribute('role', 'link');
  pin.setAttribute('tabindex', '0');
  pin.setAttribute('aria-label', `${row.name}. Open this place.`);

  const light = (on: boolean) => {
    pin.classList.toggle('is-lit', on);
    rise?.(on);
    root
      .querySelector<HTMLElement>(`[data-board-row="${CSS.escape(row.key)}"]`)
      ?.classList.toggle('is-lit', on);
    if (caption) caption.textContent = on ? row.name : '';
  };
  pin.addEventListener('mouseenter', () => light(true));
  pin.addEventListener('mouseleave', () => light(false));
  pin.addEventListener('focus', () => light(true));
  pin.addEventListener('blur', () => light(false));
  pin.addEventListener('click', (event) => {
    event.stopPropagation();
    hooks.open(row);
  });
  pin.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    hooks.open(row);
  });
}

/* ========================= the public surface ========================= */

/** What a pin needs from main.ts to be a link: escaping, and where it goes. */
export interface BoardMapHooks {
  esc(value: string): string;
  /** Open the place this pin stands for. */
  open(row: BoardPlace): void;
}

export function destroyMap(): void {
  boardMounting += 1;
  if (useGoogle) {
    detachMap(googleBoard);
  } else if (leafletBoard) {
    leafletBoard.remove();
    leafletBoard = null;
  }
  // Every teardown of the main map is a view change or a re-render; the
  // detail's locator map goes with it and is remounted below if still needed.
  destroyLocatorMap();
}

export function destroyLocatorMap(): void {
  locatorMounting += 1;
  if (useGoogle) {
    detachMap(googleLocator);
  } else if (leafletLocator) {
    leafletLocator.remove();
    leafletLocator = null;
  }
}

/**
 * The selected place, pinned. Dragging and touch zoom are on — a locator you
 * cannot zoom out of tells you the street but not the district. Scroll-wheel zoom
 * never hijacks page scrolling. Whichever provider drew the map credits itself in
 * the map's own corner; the caption line that used to sit under this map read as
 * a section of the page rather than as map small print.
 */
export function mountLocatorMap(root: HTMLElement, v: Venue): void {
  if (v.lat === null || v.lng === null) return;
  mountPointMap(root, PLACE_MAP_ID, v.lat, v.lng);
}

/**
 * One pin, one place, in whichever container names itself.
 *
 * Split out of `mountLocatorMap` so the private place page can plot an imported
 * place without being handed a catalogue `Venue` it does not have. Both pages
 * share one locator handle, which is correct: only one of them is ever mounted,
 * and a single handle is what guarantees the previous map is off screen before
 * the next one is shown.
 */
function mountPointMap(
  root: HTMLElement,
  containerId: string,
  lat: number,
  lng: number
): void {
  destroyLocatorMap();
  const container = root.querySelector<HTMLElement>(`#${containerId}`);
  if (!container) return;
  if (useGoogle) googleMountPoint(container, lat, lng);
  else leafletMountPoint(container, lat, lng);
}

/**
 * The board's own map, fitted to whatever the chips left.
 *
 * ONE MAP FOR EVERY CITY SURFACE — the city page, the guide page, whichever lens
 * or reading is on screen. A pin is a dot rather than a labelled name: the list
 * beside it is the legend, and hovering either half lights the other.
 */
export function mountBoardMap(
  root: HTMLElement,
  pins: BoardPlace[],
  hooks: BoardMapHooks
): void {
  destroyMap();
  const container = root.querySelector<HTMLElement>('#venue-map');
  if (!container || !pins.length) return;
  if (useGoogle) googleMountBoard(root, container, pins, hooks);
  else leafletMountBoard(root, container, pins, hooks);
}
