export interface OverpassElement {
  type: string;
  id: number;
  tags?: {
    [key: string]: string;
  };
}

export interface AdminOverpassElement {
  id: number;
  type: 'Feature' | 'node' | 'way' | 'relation';
  tags?: Record<string, string>;
  geometry?: { lon: number; lat: number }[];
}

export interface OverpassResponse {
  elements: OverpassElement[];
}
