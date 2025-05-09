export interface OverpassElement {
  type: string;
  id: number;
  tags?: {
    [key: string]: string;
  };
}

export interface OverpassResponse {
  elements: OverpassElement[];
}
