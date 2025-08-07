/**
 * 도로 분할 처리 이후 생성된 Link Segment 정보
 * - 도로의 Node 기준 분할 결과를 저장
 * - 실제 DB 저장 또는 파일(JSON) 변환 시 사용
 */
export interface SplitLinkSegment {
  /** 세그먼트 고유 ID (자동 증가) */
  id: number;

  /** LineString 형식의 도로 형상 (WKT) */
  geom: string;

  /** 원본 OSM 도로 ID (예: way ID 또는 relation ID) */
  osm_id: number;

  /** OSM 객체 타입 (예: 'way', 'relation') */
  osm_type: string;

  /** 도로 유형 (예: residential, primary 등 OSM 태그 기반) */
  highway: string;

  /** 일방통행 여부 ('yes' | 'no' | 'reversible' 등) */
  oneway: string;

  /** 도로의 층(layer) 정보 (예: 지하, 지상, 고가 구분) */
  layer: string;

  /** 도로명 (한글) */
  name_ko: string;

  /** 도로명 (영문) */
  name_en: string;
}

/**
 * OSM 원본 데이터를 기반으로 추출한 Link Row 정보
 * - OSM에서 수집된 도로 네트워크를 시스템 내로 가져올 때 사용
 */
export interface OsmLinkRow {
  /** 도로 형상 (WKT 또는 GeoJSON - 도입부 처리에 따라 다름) */
  geometry: string;

  /** 원본 OSM 도로 ID */
  osm_id: number;

  /** OSM 객체 타입 ('way' 또는 'relation') */
  osm_type: string;

  /** 도로 유형 */
  highway: string;

  /** 일방통행 여부 */
  oneway: string;

  /** 도로 층(layer) 정보 */
  layer: string;

  /** 도로명 (한글) */
  name_ko: string;

  /** 도로명 (영문) */
  name_en: string;
}
