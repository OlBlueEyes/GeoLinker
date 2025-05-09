export interface SplitLinkSegment {
  id: number;
  geom: string;
  osm_id: number;
  osm_type: string;
  highway: string;
  oneway: string;
  name_ko: string;
  name_en: string;
}

export interface OsmLinkRow {
  geometry: string;
  osm_id: number;
  osm_type: string;
  highway: string;
  oneway: string;
  name_ko: string;
  name_en: string;
}
