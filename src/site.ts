/**
 * The one address Detour is handed out under.
 *
 * A link that leaves the app — an invitation pasted into WhatsApp, a place URL
 * sent to somebody who has never seen Detour — outlives the tab it was copied
 * from. Building those from `window.location.origin` means whichever host the
 * member happened to be on becomes the address a stranger sees: a preview
 * deployment, a staging hostname, `localhost`. So outbound links are written
 * against the canonical origin and nothing else.
 *
 * In-app navigation still uses relative paths, which is why this is only ever
 * reached through `absoluteUrl`.
 */
const CANONICAL_ORIGIN = 'https://takedetour.app';

export const siteOrigin = CANONICAL_ORIGIN;

/** A path within Detour as the absolute URL somebody outside it can open. */
export function absoluteUrl(path: string): string {
  return new URL(path, CANONICAL_ORIGIN).toString();
}
