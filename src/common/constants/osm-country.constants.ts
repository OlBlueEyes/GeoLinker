export const OSM_COUNTRIES = [
  { name: 'South_Korea', relationId: 307756 },
  { name: 'Singapore', relationId: 536780 },
  { name: 'United_Arab_Emirates', relationId: 307763 },
  { name: 'Saudi_Arabia', relationId: 307584 },
] as const;

export type OsmCountry = (typeof OSM_COUNTRIES)[number];
