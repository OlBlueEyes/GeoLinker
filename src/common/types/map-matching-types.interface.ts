export type FrameRow = { id: number; geom: string; yaw: number };

export type NodeRow = { id: number; geom: string };

export type LinkRow = {
  linkid: number;
  linkGeom: string;
  startNode: number;
  endNode: number;
  oppositeNode: NodeRow;
};

export type LineStringWithNode = {
  lineString: string;
  projectedLineString: string;
  lastFrameInSegment: number;
  link: LinkRow;
  distances: number[];
};

export interface LinkWithOppositeNode {
  linkid: number;
  linkGeom: string;
  startNode: number;
  endNode: number;
  oppositeNode: {
    id: number;
    geom: string;
  };
}

export type LinkRowWithNode = {
  linkid: number;
  link_geom: string;
  start_node: number;
  end_node: number;
  opposite_node_id: number;
  opposite_node_geom: string;
};
