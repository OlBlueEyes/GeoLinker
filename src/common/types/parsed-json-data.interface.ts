export interface ParsedGeoJSON {
  features: Array<{
    type: string;
    geometry: { type: string };
    properties: Record<string, unknown>;
  }>;
}

export interface PostGISGeoJSONFeature {
  type: 'Feature';
  geometry: {
    type: string;
    coordinates: number[] | number[][] | number[][][];
  };
  properties: {
    type: 'node';
  };
}

export interface PostGISGeoJSON {
  geojson: {
    type: 'FeatureCollection';
    features: PostGISGeoJSONFeature[];
  };
}
