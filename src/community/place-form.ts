/**
 * The recommendation form's shared machinery: the place-identity collision
 * lookup, the note rule, the map-link reader, and the field fragments (links,
 * photo, category) that the recommend form, the entry editor and the
 * onboarding question all build from — one description of each, so the two
 * places a recommendation gets written cannot drift apart.
 */
import { pb } from '../pocketbase';
import { esc } from './store';

/** The place the server found when a submitted name and city were already taken. */
export interface PlaceCollision {
  entry: string;
  venue_name: string;
  city: string;
  address: string;
  disambiguator: string;
  published: boolean;
}
export const CATEGORY_OPTIONS = [
  ['restaurant', 'Restaurant'],
  ['ethnic_cuisine', 'Ethnic cuisine'],
  ['cafe', 'Café'],
  ['bakery', 'Bakery'],
  ['bar', 'Bar'],
  ['cocktail_bar', 'Cocktail bar'],
  ['wine_bar', 'Wine bar'],
  ['brewery', 'Brewery'],
  ['food_market', 'Food market'],
  ['deli', 'Deli'],
  ['dessert_shop', 'Dessert shop'],
  ['ice_cream', 'Ice cream'],
  ['takeaway', 'Takeaway'],
  ['other', 'Other'],
] as const;
/**
 * The place a submission collided with, or null when the failure was something else.
 *
 * The refusal itself is a 409 and carries no facts: PocketBase rewrites an
 * ApiError's `data` into a validation-error map, so anything put there arrives as
 * {code:'validation_invalid_value'} and is worse than nothing. The place is
 * fetched separately instead.
 *
 * Returns null unless a real entry comes back, so a failed lookup falls through to
 * the ordinary error notice rather than posing a question with no answer behind
 * it — "that's the one" resolves by entry id, and without one it cannot.
 */
export async function placeCollisionFor(
  error: unknown,
  asked: { venueName: string; city: string; disambiguator?: string }
): Promise<PlaceCollision | null> {
  if (!error || typeof error !== 'object') return null;
  if ((error as { status?: number }).status !== 409) return null;
  try {
    const found = (await pb.send('/api/detour/place-identity', {
      method: 'GET',
      query: {
        name: asked.venueName,
        city: asked.city,
        disambiguator: asked.disambiguator || '',
      },
      requestKey: null,
    })) as Partial<PlaceCollision> | null;
    if (!found || typeof found.entry !== 'string' || !found.entry) return null;
    return {
      entry: found.entry,
      venue_name: String(found.venue_name || asked.venueName),
      city: String(found.city || asked.city),
      address: String(found.address || ''),
      disambiguator: String(found.disambiguator || ''),
      published: found.published === true,
    };
  } catch {
    return null;
  }
}

/**
 * Moves focus to the same-place question — to the field when one is being asked
 * for, otherwise to the heading, since `autofocus` does not fire on markup that
 * was injected rather than parsed.
 */
export function focusCollision(root: HTMLElement): void {
  window.requestAnimationFrame(() => {
    const field = root.querySelector<HTMLInputElement>('[data-collision-distinct-form] input[name="disambiguator"]');
    const target = field || root.querySelector<HTMLElement>('#community-collision-title');
    target?.scrollIntoView({
      block: 'center',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    target?.focus({ preventScroll: true });
  });
}
/** The client half of the server's note rule, shared with the new-member flow. */
export function meaningfulRecommendation(note: string): boolean {
  const cleaned = note.trim().replace(/\s+/g, ' ');
  const words = cleaned
    .split(' ')
    .map((word) => word.replace(/[.,!?;:'"()\[\]{}<>/\\|`~@#$%^&*+=_-]+/g, ''))
    .filter((word) => word.length >= 2);
  return cleaned.length >= 24 && words.length >= 5;
}
/**
 * The place's public links, plus the photo the member attaches to their own
 * recommendation.
 *
 * The website and Instagram describe the place and are shared with everyone who
 * recommends it. The photo is not: it goes on this member's recommendation,
 * appears above their note, and replaces only their own previous photo. Nobody
 * else's picture is overwritten, and the place's own cover is never touched.
 */
export function placeLinkFields(values?: {
  officialUrl?: string;
  instagramUrl?: string;
}, options?: { replaceImage?: boolean }): string {
  return `<label>Website<input name="official_url" value="${esc(values?.officialUrl)}" maxlength="300" inputmode="url" autocomplete="off" spellcheck="false" placeholder="restaurant.example"></label>
    <label>Instagram<input name="instagram_url" value="${esc(values?.instagramUrl)}" maxlength="300" autocomplete="off" spellcheck="false" placeholder="@restaurant or instagram.com/restaurant"></label>
    ${photoField({ replacing: options?.replaceImage === true })}`;
}

/** Server ceiling on an upload, mirrored so an oversized file is caught before it is sent. */
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
/** Longest edge kept when the browser re-encodes a chosen photo. */
const PHOTO_MAX_EDGE = 1600;

/**
 * The photo control: a file picker, not a URL box.
 *
 * Asking for a "direct link to a photo you took" asked for something almost
 * nobody can produce from the device the photo is on. The picker is the whole
 * point of the field working at all.
 */
export function photoField(options?: { replacing?: boolean }): string {
  const replacing = options?.replacing === true;
  return `<label class="community-photo-field">${replacing ? 'Replace your photo' : 'Your photo'} <span class="community-optional">Optional — reviewed before it appears</span>
      <input name="photo" type="file" accept="image/jpeg,image/png,image/webp">
    </label>
    <p class="community-form-note">Your photo appears with your note${replacing ? ' and replaces the one you added before' : ''}. It never becomes the place's own image, and it goes when your recommendation does.</p>`;
}

export interface PlaceLinkReading {
  resolved?: boolean;
  name?: string;
  city?: string;
  country?: string;
  address?: string;
  lat?: number | null;
  lng?: number | null;
}

/**
 * What the server could read out of a pasted map link.
 *
 * Shared by both places a recommendation gets written — the onboarding question
 * and the recommend form — so there is one description of what a link means. An
 * unreadable link is not an error here either: the route answers 200 with
 * `resolved: false` and this returns null, which every caller treats as "leave
 * what they typed alone".
 */
export async function readPlaceLink(url: string): Promise<PlaceLinkReading | null> {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const result = (await pb.send('/api/detour/place-link', {
      method: 'POST',
      body: { url: trimmed },
      requestKey: null,
    })) as PlaceLinkReading;
    if (!result?.resolved) return null;
    if (!result.name && !result.city) return null;
    return result;
  } catch {
    return null;
  }
}

/**
 * The optional link field, above the two fields it fills.
 *
 * It sits first because it is the shortcut past them, and it is labelled
 * optional in the same voice as the photo picker because ignoring it costs
 * nothing — the fields below work exactly as they always have.
 */
export function mapLinkField(): string {
  // The street and country ride along hidden, because they are facts about the
  // place rather than answers the member owes: the create hook already accepts
  // both and hands them to the geocoder that validates them. Asking for them
  // would be asking someone to type what their phone just told us.
  return `<label class="community-link-field">Paste a map link <span class="community-optional">Optional — fills in the name and city</span>
      <input name="map_link" type="url" inputmode="url" autocomplete="off" spellcheck="false" maxlength="2048" placeholder="Share from Maps and paste it here">
    </label>
    <input type="hidden" name="address" value="">
    <input type="hidden" name="country" value="">
    <p class="community-form-note" data-map-link-status role="status"></p>`;
}

/**
 * Wires the link field to the name and city inputs beside it.
 *
 * Writes to the DOM rather than through a render, because this form holds its
 * values in the DOM and is not re-rendered while it is being filled in — going
 * through state would wipe the note mid-sentence. Nothing here can block the
 * form: the failure path writes a sentence into the status line and stops.
 */
export function bindMapLinkField(form: HTMLElement): void {
  const field = form.querySelector<HTMLInputElement>('input[name="map_link"]');
  if (!field) return;
  const status = form.querySelector<HTMLElement>('[data-map-link-status]');
  const nameInput = form.querySelector<HTMLInputElement>('input[name="venue_name"]');
  const cityInput = form.querySelector<HTMLInputElement>('input[name="city"]');
  let reading = false;
  let lastRead = '';

  const say = (text: string): void => {
    if (status) status.textContent = text;
  };

  const read = async (): Promise<void> => {
    const url = field.value.trim();
    if (!url || reading || url === lastRead) return;
    reading = true;
    lastRead = url;
    field.disabled = true;
    say('Reading the link…');
    const result = await readPlaceLink(url);
    field.disabled = false;
    reading = false;
    if (!result) {
      say('That link did not name a place. Type the name instead — it works just as well.');
      field.focus();
      return;
    }
    const previousName = nameInput?.value.trim() || '';
    if (result.name && nameInput) nameInput.value = result.name;
    if (result.city && cityInput) cityInput.value = result.city;
    // Hidden facts are replaced wholesale, including being cleared: a second
    // link must never leave the first place's street attached to this one.
    const hidden = (name: string): HTMLInputElement | null =>
      form.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`);
    const addressInput = hidden('address');
    const countryInput = hidden('country');
    if (addressInput) addressInput.value = result.address || '';
    if (countryInput) countryInput.value = result.country || '';
    const filled = [nameInput?.value || '', cityInput?.value || ''].filter(Boolean).join(', ');
    say(
      previousName && result.name && previousName !== result.name
        ? `From the link: ${filled}. It replaced "${previousName}" — change it back if that was the right one.`
        : `From the link: ${filled}. Change either if it is not what you call it.`
    );
    field.value = '';
    // The note is the only thing left that nobody else can write.
    form.querySelector<HTMLTextAreaElement>('textarea[name="note"]')?.focus();
  };

  field.addEventListener('paste', (event) => {
    const pasted = event.clipboardData?.getData('text') || '';
    if (!pasted.trim()) return;
    field.value = pasted.trim();
    event.preventDefault();
    void read();
  });
  field.addEventListener('change', () => void read());
  field.addEventListener('blur', () => void read());
  // Enter reads the link rather than submitting a form whose note is still empty.
  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void read();
  });
}

/**
 * The category select, shared by the recommend form and the entry's own edit
 * form so both offer the same list in the same words.
 *
 * Optional in both. A member with nothing to pick is never held up, and the
 * enrichment passes still fill a blank one from the place itself — the field is
 * here because the member standing in the place is the one who knows, not
 * because the record needs them to answer.
 */
export function categoryField(selected = ''): string {
  const options = CATEGORY_OPTIONS.map(
    ([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`
  ).join('');
  return `<label>Category <span class="community-optional">Optional</span><select name="category"><option value=""${
    selected ? '' : ' selected'
  }>Choose one</option>${options}</select></label>`;
}

/** The chosen file from a form's photo picker, or null when none was chosen. */
export function chosenPhoto(form: HTMLFormElement): File | null {
  const input = form.querySelector<HTMLInputElement>('input[name="photo"]');
  const file = input?.files?.[0];
  return file || null;
}

/**
 * Re-encodes a chosen photo down to PHOTO_MAX_EDGE on its longest side.
 *
 * A phone photo is several megabytes and far larger than any surface here
 * renders, and the server has to inline the bytes as base64 to screen them.
 * Shrinking in the browser makes the upload quick on a phone connection and
 * keeps screening cheap. Any failure returns the original file: a slow upload is
 * a much better outcome than a lost photo.
 */
export async function preparePhoto(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') return file;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const longestEdge = Math.max(bitmap.width, bitmap.height);
    if (longestEdge <= PHOTO_MAX_EDGE && file.size <= 1_500_000) return file;
    const scale = Math.min(1, PHOTO_MAX_EDGE / longestEdge);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const encoded = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.82);
    });
    return encoded && encoded.size < file.size ? encoded : file;
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}

/** A filename the server can infer a type from, since a re-encode loses the original's. */
export function photoFileName(prepared: Blob, original: File): string {
  const type = prepared.type || original.type;
  const extension = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  return `recommendation.${extension}`;
}
/**
 * Queues the member's photo for screening and founder review. The server
 * attaches it to the caller's own recommendation for this place — it is never
 * applied to the place itself, and never touches another member's photo.
 */
export async function submitImageForReview(waitlistId: string, photo: File): Promise<void> {
  if (!waitlistId || !photo) return;
  const prepared = await preparePhoto(photo);
  if (prepared.size > PHOTO_MAX_BYTES) {
    throw new Error('That photo is larger than 8 MB even after resizing. Choose a smaller one.');
  }
  // Multipart, so the bytes go to the server rather than a link to them. pb.send
  // passes FormData through untouched and sets no JSON content type.
  const body = new FormData();
  body.set('waitlist', waitlistId);
  body.set('photo', prepared, photoFileName(prepared, photo));
  await pb.send('/api/detour/curation/images', { method: 'POST', body, requestKey: null });
}
