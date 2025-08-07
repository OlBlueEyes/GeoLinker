import {
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 링크 정보와 해당 링크의 반대편 Node 정보를 포함하는 DTO
 */
export class LinkWithOppositeNodeDto {
  /** Link 고유 ID */
  @IsNumber()
  linkid: number;

  /** LineString 형식의 링크 형상 (WKT) */
  @IsString()
  linkGeom: string;

  /** 텍스트로 직렬화된 Link geometry (예: "LINESTRING(...)") */
  @IsString()
  linkGeomText: string;

  /** 일방통행 여부 ('yes' | 'no' 등), 없을 수 있음 */
  @IsOptional()
  @IsString()
  oneway: string;

  /** 도로 종류 (예: 'primary', 'residential'), 없을 수 있음 */
  @IsOptional()
  @IsString()
  highway: string;

  /** 도로 층 정보 (지하/지상 등), 없을 수 있음 */
  @IsOptional()
  @IsString()
  layer: string;

  /** 시작 노드 ID */
  @IsNumber()
  source: number;

  /** 종료 노드 ID */
  @IsNumber()
  target: number;

  /** 이 링크와 연결된 반대편 Node 정보 */
  @ValidateNested()
  @Type(() => OppositeNodeDto)
  oppositeNode: OppositeNodeDto;
}

/**
 * Link와 연결된 반대 Node의 식별자 및 위치 정보
 */
export class OppositeNodeDto {
  /** Node ID */
  @IsNumber()
  id: number;

  /** Node 위치 (Point 형식 WKT) */
  @IsString()
  geom: string;
}

export class QueryResultDto {
  /** Link 고유 ID */
  @IsNumber()
  linkid: number;

  /** LineString 형식의 링크 형상 (WKT) */
  @IsString()
  link_geom: string;

  /** 텍스트로 직렬화된 Link geometry (예: "LINESTRING(...)") */
  @IsString()
  link_geom_text: string;

  /** 일방통행 여부 ('yes' | 'no' 등), 없을 수 있음 */
  @IsOptional()
  @IsString()
  oneway: string;

  /** 도로 종류 (예: 'primary', 'residential'), 없을 수 있음 */
  @IsOptional()
  @IsString()
  highway: string;

  /** 도로 층 정보 (지하/지상 등), 없을 수 있음 */
  @IsOptional()
  @IsString()
  layer: string;

  /** 시작 노드 ID */
  @IsNumber()
  source: number;

  /** 종료 노드 ID */
  @IsNumber()
  target: number;
  /** 종료 노드 ID */

  @IsNumber()
  opposite_node_id: number;

  /** 종료 노드 ID */
  @IsNumber()
  opposite_node_geom: string;
}
