import { IsString, IsNumber, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { LinkWithOppositeNodeDto } from './link-with-opposite-node.dto';

/**
 * Frame과 Link 간 유사도 계산을 위한 LineString 및 거리 정보를 담은 DTO
 */
export class LineStringWithNodeDto {
  /** 실제 Frame 좌표들을 연결한 LineString (WKT) */
  @IsString()
  frameLineString: string;

  /** 링크 상에 투영된 지점들을 연결한 LineString (WKT) */
  @IsString()
  projectedLineString: string;

  /** 해당 링크에 포함되는 마지막 Frame의 ID */
  @IsNumber()
  lastFrameInSegment: number;

  /** 해당 구간과 연결된 링크 및 opposite node 정보 */
  @ValidateNested()
  @Type(() => LinkWithOppositeNodeDto)
  link: LinkWithOppositeNodeDto;

  /** 각 Frame이 링크에 투영된 거리 (단위: meter) */
  @IsArray()
  @IsNumber({}, { each: true })
  distances: number[];
}
