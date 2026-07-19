export const OCCASION_OPTIONS = [
  ['celebration', 'Celebration'],
  ['casual_local_favorite', 'Casual local favorite'],
  ['coffee', 'Coffee'],
  ['bakery', 'Bakery'],
  ['drinks_nightcap', 'Drinks or a nightcap'],
  ['neighborhood_meal', 'Neighborhood meal'],
  ['date_night', 'Date night'],
  ['group_gathering', 'Group gathering'],
  ['quick_bite', 'Quick bite'],
  ['breakfast_brunch', 'Breakfast or brunch'],
  ['solo_friendly', 'Solo-friendly'],
  ['family_friendly', 'Family-friendly'],
  ['late_night', 'Late night'],
  ['outdoor_seating', 'Outdoor seating'],
] as const;

export type Occasion = (typeof OCCASION_OPTIONS)[number][0];

const OCCASION_LABELS = new Map<string, string>(OCCASION_OPTIONS);

export function occasionLabel(value: string): string {
  return OCCASION_LABELS.get(value) ?? value;
}

export function knownOccasions(value: unknown): Occasion[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<Occasion>();
  for (const item of value) {
    if (typeof item !== 'string' || !OCCASION_LABELS.has(item)) continue;
    seen.add(item as Occasion);
  }
  return [...seen];
}
