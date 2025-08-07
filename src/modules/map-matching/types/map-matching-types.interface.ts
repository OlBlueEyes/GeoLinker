/**
 * GPS Frame 데이터 시퀀스
 * - 맵매칭 대상이 되는 기본 단위
 */
export type FrameRow = {
  /** 고유 ID (Frame 테이블 PK) */
  id: number;

  /** Point 형식의 geometry (WKT, SRID: 4326) */
  geom: string;

  /** 차량의 진행 방향 각도 (0~360도) */
  yaw: number;

  /** 경도 (X좌표, EPSG:4326) */
  x: number;

  /** 위도 (Y좌표, EPSG:4326) */
  y: number;
};

/**
 * 매칭 또는 필터링 대상이 되는 도로 Link 정보
 * - BBox 또는 Node 기반 후보 링크 집합
 */
export type LinkRow = {
  /** Link 고유 ID (DB 기준 PK) */
  linkid: number;

  /** LineString 형식의 geometry (WKT, SRID: 4326) */
  link_geom: string;

  /** 시작 노드 ID */
  source: number;

  /** 종료 노드 ID */
  target: number;
};

/**
 * 노드 정보
 * - 도로 교차점 또는 분기점에 해당
 */
export interface NodeRow {
  /** Node 고유 ID */
  id: number;

  /** Node 위치 (WKT, Point) */
  geom: string;
}

/**
 * Frame 데이터를 record 단위로 구분할 때 사용하는 구조
 * - 각 record_id는 하나의 연속된 주행 단위
 */
export interface RecordRow {
  /** 레코드 식별자 (record 단위 구간 ID) */
  record_id: number;
}

/**
 * Frame 데이터 집합으로부터 계산된 Bounding Box 결과
 * - 후보 링크 필터링을 위한 공간 범위로 사용
 */
export interface BBoxResult {
  /** 확장된 BBox geometry (WKT, Polygon) */
  expanded: string;
}

/**
 * 프레임 매칭 결과를 다음 처리 루프로 넘기기 위한 구조
 */
export interface MatchResult {
  /** 마지막으로 처리된 Frame의 인덱스 */
  lastProcessedFrameIndex: number;

  /** 다음 기준이 될 Node 정보 (없을 경우 null) */
  currentNode: NodeRow | null;
}

/**
 * 단순 COUNT(*) 쿼리 결과용 구조체
 */
export interface CountResult {
  /** 총 개수 결과 */
  count: number;
}
